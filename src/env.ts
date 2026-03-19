import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

// Project root is two levels up from src/env.ts → dist/env.js
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  // .env.runtime contains resolved secrets (written by start-op.sh via `op inject`)
  // Fall back to .env which may contain op:// references
  const runtimeFile = path.join(PROJECT_ROOT, '.env.runtime');
  const envFile = path.join(PROJECT_ROOT, '.env');
  const fileToRead = fs.existsSync(runtimeFile) ? runtimeFile : envFile;
  let content: string;
  try {
    content = fs.readFileSync(fileToRead, 'utf-8');
    logger.debug({ file: fileToRead }, 'reading env from file');
  } catch (err) {
    logger.debug({ err }, '.env file not found, using defaults');
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  // process.env takes precedence (e.g. secrets injected by `docker exec -e`)
  for (const key of keys) {
    const envVal = process.env[key];
    if (envVal) {
      result[key] = envVal;
      logger.debug({ key, source: 'process.env' }, 'env var resolved from process.env');
    } else if (result[key]) {
      logger.debug({ key, source: '.env file' }, 'env var resolved from .env file');
    } else {
      logger.debug({ key }, 'env var not found in process.env or .env file');
    }
  }

  return result;
}
