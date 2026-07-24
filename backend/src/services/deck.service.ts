import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config, maxUploadBytes, maxArchiveEntryBytes, maxUncompressedBytes } from '../config.js';
import { ClientInputError } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';
import { normalizeCategoryName } from '../utils/helpers.js';
import { deckStoragePath, storedPackagePath, listFiles, storageRelative } from '../utils/storage.js';
import { fail } from '../utils/response.js';
import { RateLimiter } from '../plugins/rate-limit.js';
import { requestRateLimitKey } from '../utils/helpers.js';

export class DeckService {
  constructor(private rateLimiter: RateLimiter) {}
  
  async ensureCategory(name: string, createdById: string) {
    const normalized = normalizeCategoryName(name);
    const existing = await prisma.marketCategory.findUnique({ where: { name: normalized } });
    if (existing) return existing;
    const legacyDeck = await prisma.deck.findFirst({ 
      where: { category: normalized }, 
      select: { id: true } 
    });
    return prisma.marketCategory.create({ 
      data: { 
        name: normalized, 
        status: legacyDeck ? 'PUBLISHED' : 'PENDING', 
        createdById 
      } 
    });
  }
  
  async categoryIsApproved(name: string): Promise<boolean> {
    const category = await prisma.marketCategory.findUnique({ 
      where: { name: normalizeCategoryName(name) }, 
      select: { status: true } 
    });
    return !category || category.status === 'PUBLISHED';
  }
  
  validateArchiveEntries(zip: AdmZip) {
    const entries = zip.getEntries();
    if (!entries.length) throw new ClientInputError('ZIP package cannot be empty');
    if (entries.length > config.maxArchiveEntries) {
      throw new ClientInputError(`ZIP package contains too many entries (maximum ${config.maxArchiveEntries})`);
    }
    
    const seen = new Set<string>();
    let totalUncompressedBytes = 0;
    
    for (const entry of entries) {
      const rawName = entry.entryName.replaceAll('\\', '/');
      const normalized = path.posix.normalize(rawName);
      const parts = normalized.split('/');
      const isDirectory = rawName.endsWith('/');
      
      if (!rawName || rawName.includes('\0') || path.posix.isAbsolute(rawName) || 
          /^[A-Za-z]:[\\/]/.test(rawName) || parts.includes('..') || 
          normalized === '.' || normalized.startsWith('../')) {
        throw new ClientInputError('ZIP package contains an unsafe path');
      }
      
      if (seen.has(normalized)) {
        throw new ClientInputError(`ZIP package contains a duplicate path: ${normalized}`);
      }
      seen.add(normalized);
      
      const size = Number(entry.header.size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new ClientInputError('ZIP package contains an invalid file size');
      }
      
      if (!isDirectory && size > maxArchiveEntryBytes) {
        throw new ClientInputError(`ZIP entry exceeds the ${Math.floor(maxArchiveEntryBytes / 1024 / 1024)} MB limit`);
      }
      
      totalUncompressedBytes += size;
      if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > maxUncompressedBytes) {
        throw new ClientInputError(`ZIP package exceeds the ${Math.floor(maxUncompressedBytes / 1024 / 1024)} MB uncompressed limit`);
      }
    }
    return entries;
  }
  
  validateManifest(zip: AdmZip) {
    this.validateArchiveEntries(zip);
    const manifestEntry = zip.getEntry('manifest.json');
    const cardsEntry = zip.getEntry('cards.json');
    
    if (!manifestEntry || !cardsEntry) {
      throw new ClientInputError('Package must contain manifest.json and cards.json');
    }
    
    let rawManifest: unknown;
    let cards: unknown;
    try {
      rawManifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
      cards = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new ClientInputError('manifest.json and cards.json must contain valid JSON');
    }
    
    const manifest = z.object({
      format: z.string().default('knowledge-review-deck'),
      title: z.string().min(1).max(160),
      description: z.string().max(2000).default(''),
      category: z.string().max(80).optional(),
      version: z.number().int().positive(),
      cardCount: z.number().int().nonnegative().optional(),
      changelog: z.string().max(5000).optional()
    }).parse(rawManifest);
    
    if (!Array.isArray(cards)) {
      throw new ClientInputError('cards.json must contain an array');
    }
    
    if (manifest.cardCount !== undefined && manifest.cardCount !== cards.length) {
      throw new ClientInputError('manifest.cardCount does not match cards.json');
    }
    
    return { manifest, cards };
  }
  
  inspectPackage(filePath: string) {
    try {
      return this.validateManifest(new AdmZip(filePath));
    } catch (error) {
      if (error instanceof ClientInputError || error instanceof z.ZodError) throw error;
      throw new ClientInputError('Invalid ZIP deck package');
    }
  }
  
  async readUpload(part: Awaited<ReturnType<FastifyRequest['file']>>) {
    if (!part) throw new ClientInputError('A deck ZIP file is required');
    if (!part.filename.toLowerCase().endsWith('.zip')) {
      throw new ClientInputError('Only .zip deck packages are supported');
    }
    
    const tempPath = path.join(config.storageDir, `.upload-${crypto.randomUUID()}.tmp`);
    try {
      await pipeline(part.file, fs.createWriteStream(tempPath));
      const stat = await fsp.stat(tempPath);
      if (stat.size > maxUploadBytes) {
        throw new ClientInputError('Upload exceeds the configured size limit');
      }
      return { tempPath, size: stat.size };
    } catch (error) {
      await fsp.rm(tempPath, { force: true });
      throw error;
    }
  }
  
  async saveVersion(deckId: string, version: number, upload: { tempPath: string; size: number }, manifest: object) {
    const targetDir = path.join(config.storageDir, 'decks', deckId, `v${version}`);
    const target = path.join(targetDir, 'package.zip');
    try {
      const saved = await prisma.$transaction(async (tx) => {
        // Serialize version allocation per deck. The lock also protects the
        // deterministic package path from concurrent uploads of different versions.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${deckId}))`;
        const deck = await tx.deck.findUnique({
          where: { id: deckId },
          select: { currentVersion: true },
        });
        if (!deck) throw new ClientInputError('Deck not found');
        if (version <= deck.currentVersion) {
          throw new ClientInputError(`Version must be greater than the current version (${deck.currentVersion})`);
        }

        const existing = await tx.deckVersion.findUnique({
          where: { deckId_version: { deckId, version } },
        });
        if (existing) throw new ClientInputError(`Version ${version} already exists`);

        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.copyFile(upload.tempPath, target, fs.constants.COPYFILE_EXCL);
        const hash = await sha256(target);
        const item = await tx.deckVersion.create({ 
          data: { 
            deckId, version, status: 'PENDING', 
            packagePath: target, packageSize: BigInt(upload.size), 
            sha256: hash, manifest 
          } 
        });
        await tx.deck.update({ 
          where: { id: deckId }, 
          data: { currentVersion: version } 
        });
        return item;
      });
      return { version: saved.version, sha256: saved.sha256 };
    } catch (error) {
      await fsp.rm(target, { force: true });
      throw error;
    }
  }
  
  async inspectStorage() {
    const versions = await prisma.deckVersion.findMany({ 
      select: { id: true, deckId: true, version: true, packagePath: true } 
    });
    const referenced = new Set(versions.map((v) => path.resolve(storedPackagePath(v.packagePath))));
    const packageRoot = path.join(config.storageDir, 'decks');
    const files = await listFiles(packageRoot);
    
    const missing = versions
      .filter((v) => !fs.existsSync(storedPackagePath(v.packagePath)))
      .map((v) => ({ 
        id: v.id, deckId: v.deckId, version: v.version, 
        path: storageRelative(storedPackagePath(v.packagePath)) || v.packagePath 
      }));
    
    const orphanFiles = files
      .filter((file) => !referenced.has(path.resolve(file)))
      .map((file) => storageRelative(file) || file);
    
    const topLevel = await fsp.readdir(config.storageDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    const temporary = topLevel.filter((e) => e.isFile() && e.name.startsWith('.upload-')).map((e) => e.name);
    const quarantine = topLevel.filter((e) => e.isDirectory() && e.name.startsWith('.deleting-')).map((e) => e.name);
    
    return { 
      referencedCount: versions.length, fileCount: files.length, 
      missing, orphanFiles, temporary, quarantine, 
      healthy: missing.length === 0 && orphanFiles.length === 0 && temporary.length === 0 && quarantine.length === 0 
    };
  }
}
