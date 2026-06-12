/**
 * File-system scanning helper for the pattern-based tools.
 *
 * Walks a directory recursively, skipping common non-source directories
 * (vendor, node_modules, .git, …), reads each file and yields its
 * absolute path. Caps the total bytes read so a runaway tree cannot
 * exhaust memory.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB total
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'cache',
  'tmp',
  'temp',
  'storage',
  'var',
  'public',
  'resources',
  'lang',
  'locale',
  'locales'
]);

const SKIP_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.lock'
]);

const PHP_EXTENSIONS = new Set(['.php', '.phtml', '.php5', '.php7', '.phps', '.inc', '.module']);

const isPhpFile = (filename: string): boolean => {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) {
    return false;
  }
  return PHP_EXTENSIONS.has(filename.slice(idx).toLowerCase());
};

const isSkipDir = (name: string): boolean => SKIP_DIRS.has(name) || name.startsWith('.');

const isSkippableFile = (filename: string): boolean => {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) {
    return false;
  }
  return SKIP_EXTENSIONS.has(filename.slice(idx).toLowerCase());
};

export interface ScanFile {
  readonly path: string;
  readonly relative: string;
  readonly size: number;
  readonly content: string;
}

export interface ScanOptions {
  readonly root: string;
  readonly onlyPhp?: boolean;
  readonly maxBytes?: number;
}

export interface ScanResult {
  readonly files: readonly ScanFile[];
  readonly totalBytes: number;
  readonly truncated: boolean;
  readonly visitedDirs: number;
}

const readAll = async (): Promise<readonly ScanFile[]> => {
  throw new Error('unreachable');
};

export const scanFiles = async (options: ScanOptions): Promise<ScanResult> => {
  const files: ScanFile[] = [];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let totalBytes = 0;
  let truncated = false;
  let visitedDirs = 0;
  const queue: string[] = [options.root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    visitedDirs += 1;

    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isSkipDir(entry.name)) {
          queue.push(child);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (isSkippableFile(entry.name)) {
        continue;
      }
      if (options.onlyPhp === true && !isPhpFile(entry.name)) {
        continue;
      }

      let info: import('node:fs').Stats;
      try {
        info = await stat(child);
      } catch {
        continue;
      }
      if (info.size > 2 * 1024 * 1024) {
        continue; // skip very large files (likely data)
      }
      if (totalBytes + info.size > maxBytes) {
        truncated = true;
        continue;
      }

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(child, 'utf8').catch(() => '');
      files.push({
        path: child,
        relative: relative(options.root, child).split('\\').join('/'),
        size: info.size,
        content
      });
      totalBytes += info.size;
    }
  }

  return { files, totalBytes, truncated, visitedDirs };
};

void readAll;
