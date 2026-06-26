#!/usr/bin/env node

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMigrationUri } from './google-auth-migration.js';
import { decodeQrImage, describeSourcePath, listImageFiles, looksLikeImagePath } from './qr-image.js';

const DEFAULT_QR_DIRECTORY = 'folder_qr';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDefaultDirectory = join(scriptDirectory, '..', DEFAULT_QR_DIRECTORY);

function printHelp() {
  process.stdout.write(`Usage: ga2apple [migration-uri-or-file] [options]

Decode a Google Authenticator export URI into Apple Passwords setup data.

Input sources:
  - direct otpauth-migration:// URI argument
  - path to a text file containing the URI
  - path to a QR image containing the export payload
  - path to a folder of QR images
  - ./folder_qr by default when no argument is provided
  - stdin when no argument is provided and ./folder_qr does not exist

Options:
  --json    Print machine-readable JSON instead of a text report
  --csv     Write a CSV export to the given path
  --md      Write a Markdown checklist to the given path
  --help    Show this help message
`);
}

function readStdin() {
  return readFileSync(0, 'utf8');
}

function parseCliArgs(args) {
  const options = {
    help: false,
    json: false,
    csvPath: null,
    markdownPath: null,
    input: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--csv') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Expected a file path after --csv');
      }
      options.csvPath = value;
      index += 1;
      continue;
    }

    if (arg === '--md') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Expected a file path after --md');
      }
      options.markdownPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.input !== null) {
      throw new Error('Expected at most one input argument');
    }

    options.input = arg;
  }

  return options;
}

function mergeParsedMigrations(parsedMigrations) {
  if (parsedMigrations.length === 0) {
    throw new Error('No Google Authenticator exports were decoded');
  }

  if (parsedMigrations.length === 1) {
    return parsedMigrations[0].parsed;
  }

  return {
    version: null,
    batchSize: null,
    batchIndex: null,
    batchId: null,
    entries: parsedMigrations.flatMap((item) => item.parsed.entries),
    sources: parsedMigrations.map((item) => item.source)
  };
}

function decodeDirectory(directoryPath) {
  const imageFiles = listImageFiles(directoryPath);

  if (imageFiles.length === 0) {
    throw new Error(`No supported QR image files found in ${directoryPath}`);
  }

  const parsedMigrations = imageFiles.map((imagePath) => ({
    source: describeSourcePath(imagePath),
    parsed: parseMigrationUri(decodeQrImage(imagePath))
  }));

  return mergeParsedMigrations(parsedMigrations);
}

function resolveInput(input) {
  if (input === null) {
    const candidateDirectories = [
      join(process.cwd(), DEFAULT_QR_DIRECTORY),
      projectDefaultDirectory
    ];

    for (const defaultDirectory of candidateDirectories) {
      if (existsSync(defaultDirectory) && statSync(defaultDirectory).isDirectory()) {
        return decodeDirectory(defaultDirectory);
      }
    }

    return parseMigrationUri(readStdin());
  }

  const candidate = input;
  if (candidate.startsWith('otpauth-migration://')) {
    return parseMigrationUri(candidate);
  }

  if (existsSync(candidate)) {
    const stats = statSync(candidate);
    if (stats.isDirectory()) {
      return decodeDirectory(candidate);
    }

    if (looksLikeImagePath(candidate)) {
      return parseMigrationUri(decodeQrImage(candidate));
    }
    return parseMigrationUri(readFileSync(candidate, 'utf8'));
  }

  return parseMigrationUri(candidate);
}

function needsManualReview(entry) {
  return entry.type !== 'TOTP' || entry.algorithm !== 'SHA1' || entry.digits !== 6;
}

function formatEntry(entry, index) {
  const lines = [
    `${index + 1}. ${entry.label}`,
    `Apple setup key: ${entry.secretBase32}`,
    `Type: ${entry.type} | Algorithm: ${entry.algorithm} | Digits: ${entry.digits}`
  ];

  if (entry.counter !== null) {
    lines.push(`Counter: ${entry.counter}`);
  }

  lines.push(`OTPAuth URL: ${entry.otpauthUrl}`);

  if (needsManualReview(entry)) {
    lines.push('Warning: non-default OTP parameters. Verify this entry carefully in Apple Passwords.');
  }

  return lines.join('\n');
}

function formatTextReport(parsed) {
  const countLabel = parsed.entries.length === 1 ? 'account' : 'accounts';
  const header = [
    `Decoded ${parsed.entries.length} ${countLabel} from Google Authenticator export.`,
    `Batch metadata: version=${parsed.version ?? 'unknown'} batchSize=${parsed.batchSize ?? 'unknown'} batchIndex=${parsed.batchIndex ?? 'unknown'} batchId=${parsed.batchId ?? 'unknown'}`
  ];

  if (parsed.sources?.length) {
    header.push(`Sources: ${parsed.sources.join(', ')}`);
  }

  const entries = parsed.entries.map(formatEntry);
  return `${header.join('\n')}\n\n${entries.join('\n\n')}\n`;
}

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function formatCsvExport(parsed) {
  const header = ['label', 'issuer', 'name', 'secretBase32', 'type', 'algorithm', 'digits', 'counter', 'otpauthUrl'];
  const rows = parsed.entries.map((entry) => [
    entry.label,
    entry.issuer,
    entry.name,
    entry.secretBase32,
    entry.type,
    entry.algorithm,
    entry.digits,
    entry.counter,
    entry.otpauthUrl
  ]);

  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
    .concat('\n');
}

function formatMarkdownChecklist(parsed) {
  const lines = [
    '# Google Authenticator Migration Checklist',
    '',
    `Decoded ${parsed.entries.length} ${parsed.entries.length === 1 ? 'account' : 'accounts'}.`
  ];

  if (parsed.sources?.length) {
    lines.push('', `Sources: ${parsed.sources.join(', ')}`);
  }

  for (const entry of parsed.entries) {
    lines.push('');
    lines.push(`- [ ] ${entry.label}`);
    lines.push(`  Setup key: \`${entry.secretBase32}\``);
    lines.push(`  Type: ${entry.type} | Algorithm: ${entry.algorithm} | Digits: ${entry.digits}`);
    lines.push(`  OTPAuth URL: \`${entry.otpauthUrl}\``);
    if (entry.counter !== null) {
      lines.push(`  Counter: ${entry.counter}`);
    }
    if (needsManualReview(entry)) {
      lines.push('  Warning: non-default OTP parameters. Verify this entry carefully in Apple Passwords.');
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeOptionalExports(parsed, options) {
  const notices = [];

  if (options.csvPath) {
    writeFileSync(options.csvPath, formatCsvExport(parsed), 'utf8');
    notices.push(`Wrote CSV export: ${options.csvPath}`);
  }

  if (options.markdownPath) {
    writeFileSync(options.markdownPath, formatMarkdownChecklist(parsed), 'utf8');
    notices.push(`Wrote Markdown checklist: ${options.markdownPath}`);
  }

  return notices;
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const parsed = resolveInput(options.input);
  const notices = writeOptionalExports(parsed, options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    if (notices.length > 0) {
      process.stdout.write(`${notices.join('\n')}\n`);
    }
    return;
  }

  process.stdout.write(formatTextReport(parsed));
  if (notices.length > 0) {
    process.stdout.write(`\n${notices.join('\n')}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
