/**
 * Cross-platform filesystem path utilities.
 *
 * MCP tools receive paths from LLMs in many shapes:
 *  - POSIX absolute:   /home/user/project/src/Foo.php
 *  - Windows absolute: C:\Users\me\project\src\Foo.php
 *  - Windows UNC:      \\server\share\Foo.php
 *  - WSL bridge:       /mnt/c/Users/me/...
 *  - Relative + ~:     ~/project/src/Foo.php
 *  - File URI:         file:///C:/Users/me/Foo.php
 *
 * Every entry point is normalised into a real, native OS path so the
 * underlying `child_process` calls never receive ambiguous input.
 */

import { isAbsolute, resolve, normalize, sep } from 'node:path';
import { homedir } from 'node:os';

const WINDOWS_DRIVE_LETTER = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\/]+[\\/]/;
const FILE_URI = /^file:\/\//i;
const TILDE_PREFIX = /^~(?=[/\\])/;

const stripFileScheme = (value: string): string => {
  if (!FILE_URI.test(value)) {
    return value;
  }
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.replace(/^file:\/\//i, '');
  }
};

const expandTilde = (value: string): string => {
  if (process.platform !== 'win32' || !TILDE_PREFIX.test(value)) {
    return value;
  }
  const driverMatch = value.match(/^~([A-Za-z]):[\\/](.*)$/);
  if (driverMatch && driverMatch[1] && driverMatch[2] !== undefined) {
    return `${driverMatch[1]}:\\${driverMatch[2].replace(/\//g, '\\')}`;
  }
  return value.replace(TILDE_PREFIX, homedir().replace(/\\/g, '/'));
};

const isWindowsStyleAbsolute = (value: string): boolean =>
  WINDOWS_DRIVE_LETTER.test(value) || WINDOWS_UNC.test(value);

const normaliseSeparators = (value: string): string => {
  if (process.platform === 'win32') {
    return value.replace(/\//g, '\\');
  }
  return value.replace(/\\/g, '/');
};

/**
 * Convert any LLM-supplied path into a real, native absolute path.
 *
 * Throws a `PathError` if the path is empty or syntactically unusable.
 */
export const normalisePath = (rawPath: string): string => {
  if (typeof rawPath !== 'string') {
    throw new PathError('Dosya yolu bir string olmalıdır.');
  }

  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    throw new PathError('Dosya yolu boş olamaz.');
  }

  let candidate = stripFileScheme(trimmed);
  candidate = expandTilde(candidate);
  candidate = normaliseSeparators(candidate);

  if (isWindowsStyleAbsolute(candidate) || isAbsolute(candidate)) {
    return normalize(candidate);
  }

  return resolve(process.cwd(), candidate);
};

/**
 * Convert a real path back to a friendly display form. Useful when echoing
 * paths back to the model so it can correlate outputs with input.
 */
export const displayPath = (absolutePath: string): string => {
  if (process.platform !== 'win32') {
    return absolutePath;
  }
  return absolutePath.split(sep).join('/');
};

export class PathError extends Error {
  public override readonly name = 'PathError';
  public constructor(message: string) {
    super(message);
  }
}
