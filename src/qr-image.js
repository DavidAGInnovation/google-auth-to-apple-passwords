import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join } from 'node:path';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.gif',
  '.bmp',
  '.webp'
]);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const decoderScriptPath = join(moduleDirectory, 'decode-qr.swift');

export function looksLikeImagePath(path) {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

export function listImageFiles(directoryPath) {
  return readdirSync(directoryPath)
    .filter((name) => looksLikeImagePath(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => join(directoryPath, name));
}

export function describeSourcePath(path) {
  return basename(path);
}

export function decodeQrImage(imagePath) {
  return execFileSync('swift', [decoderScriptPath, imagePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
