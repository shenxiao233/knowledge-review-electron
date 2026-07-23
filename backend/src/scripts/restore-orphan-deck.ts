import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const prisma = new PrismaClient();
const defaultDeckId = '86f00dc8-fff4-4a74-adfb-151b6e40ed34';
const applyChanges = process.argv.includes('--apply');
const deckId = process.argv.find((arg) => arg.startsWith('--deck='))?.slice('--deck='.length) || defaultDeckId;
const ownerUsername = process.argv.find((arg) => arg.startsWith('--owner='))?.slice('--owner='.length);

function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

function packagePath(version: number): string {
  return path.join(config.storageDir, 'decks', deckId, `v${version}`, 'package.zip');
}

async function findOwner() {
  if (ownerUsername) {
    const owner = await prisma.user.findUnique({ where: { username: ownerUsername } });
    if (!owner || owner.role === 'ADMIN') throw new Error(`Owner user not found or is an admin: ${ownerUsername}`);
    return owner;
  }

  const users = await prisma.user.findMany({ where: { role: 'USER' }, orderBy: { createdAt: 'asc' } });
  if (users.length !== 1) {
    throw new Error(`Cannot infer the owner safely. Pass --owner=<username>; found ${users.length} regular users.`);
  }
  return users[0];
}

async function readPackages() {
  const root = path.join(config.storageDir, 'decks', deckId);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  const versions = [];

  for (const entry of entries) {
    const match = entry.isDirectory() ? entry.name.match(/^v(\d+)$/) : null;
    if (!match) continue;
    const version = Number(match[1]);
    const filePath = packagePath(version);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Missing package file: ${filePath}`);

    const zip = new AdmZip(filePath);
    const manifestEntry = zip.getEntry('manifest.json');
    const cardsEntry = zip.getEntry('cards.json');
    if (!manifestEntry || !cardsEntry) throw new Error(`Package v${version} is missing manifest.json or cards.json`);

    let manifest: any;
    let cards: unknown;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
      cards = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(`Package v${version} contains invalid JSON`);
    }
    if (!manifest?.title || !Number.isInteger(manifest.version) || manifest.version !== version || !Array.isArray(cards)) {
      throw new Error(`Package v${version} has an invalid manifest`);
    }

    versions.push({
      version,
      filePath,
      size: stat.size,
      sha256: await sha256(filePath),
      manifest: { ...manifest, category: '' },
    });
  }

  versions.sort((a, b) => a.version - b.version);
  if (!versions.length) throw new Error(`No version packages found under ${root}`);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) throw new Error('Package versions must be contiguous starting at v1');
  }
  return versions;
}

async function main() {
  if (!/^[0-9a-f-]{36}$/i.test(deckId)) throw new Error(`Invalid deck UUID: ${deckId}`);
  const owner = await findOwner();
  const versions = await readPackages();
  const latest = versions[versions.length - 1];
  const title = latest.manifest.title;
  const description = latest.manifest.description || '';

  console.log(JSON.stringify({
    mode: applyChanges ? 'apply' : 'dry-run',
    deckId,
    owner: owner.username,
    title,
    versions: versions.map((version) => ({ version: version.version, size: version.size, sha256: version.sha256 })),
  }, null, 2));

  if (!applyChanges) return;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.deck.findUnique({ where: { id: deckId }, select: { ownerId: true } });
    if (existing && existing.ownerId !== owner.id) throw new Error('Existing deck belongs to a different owner');

    await tx.deck.upsert({
      where: { id: deckId },
      update: {
        title,
        description,
        category: '',
        status: 'PUBLISHED',
        currentVersion: latest.version,
        publishedVersion: latest.version,
      },
      create: {
        id: deckId,
        ownerId: owner.id,
        title,
        description,
        category: '',
        status: 'PUBLISHED',
        currentVersion: latest.version,
        publishedVersion: latest.version,
      },
    });

    for (const version of versions) {
      await tx.deckVersion.upsert({
        where: { deckId_version: { deckId, version: version.version } },
        update: {
          status: 'PUBLISHED',
          packagePath: version.filePath,
          packageSize: BigInt(version.size),
          sha256: version.sha256,
          manifest: version.manifest,
        },
        create: {
          deckId,
          version: version.version,
          status: 'PUBLISHED',
          packagePath: version.filePath,
          packageSize: BigInt(version.size),
          sha256: version.sha256,
          manifest: version.manifest,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: 'deck.restore_orphan',
        targetId: deckId,
        metadata: { title, restoredVersions: versions.map((version) => version.version) },
      },
    });
  });

  console.log(`Restored ${title} as ${deckId} with ${versions.length} published versions.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
