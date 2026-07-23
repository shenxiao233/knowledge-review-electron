import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ClientInputError } from './errors.js';

export function deckStoragePath(deckId: string): string {
  const root = path.resolve(config.storageDir, 'decks');
  const target = path.resolve(root, deckId);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ClientInputError('Invalid deck storage path');
  }
  return target;
}

export function storageRelative(filePath: string): string | null {
  const root = path.resolve(config.storageDir);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else if (entry.isFile()) {
      files.push(path.resolve(root, relative));
    }
  }
  return files;
}

export function storedPackagePath(packagePath: string): string {
  if (fs.existsSync(packagePath)) return packagePath;
  const match = String(packagePath).match(/(?:^|[\\/])storage[\\/](.+)$/i);
  return match ? path.resolve(config.storageDir, ...match[1].split(/[\\/]+/)) : packagePath;
}
