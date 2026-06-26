import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'src', 'cli.js');

const ALGORITHM = {
  SHA1: 1
};

const DIGITS = {
  SIX: 1
};

const OTP_TYPE = {
  TOTP: 2
};

function encodeVarint(value) {
  const bytes = [];
  let current = BigInt(value);
  while (current >= 0x80n) {
    bytes.push(Number((current & 0x7fn) | 0x80n));
    current >>= 7n;
  }
  bytes.push(Number(current));
  return Buffer.from(bytes);
}

function encodeFieldHeader(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeBytes(fieldNumber, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([
    encodeFieldHeader(fieldNumber, 2),
    encodeVarint(buffer.length),
    buffer
  ]);
}

function encodeInt(fieldNumber, value) {
  return Buffer.concat([encodeFieldHeader(fieldNumber, 0), encodeVarint(value)]);
}

function buildMigrationUri({
  secret = 'hello',
  name = 'alice@example.com',
  issuer = 'GitHub',
  batchId = 99
} = {}) {
  const otp = Buffer.concat([
    encodeBytes(1, Buffer.from(secret)),
    encodeBytes(2, name),
    encodeBytes(3, issuer),
    encodeInt(4, ALGORITHM.SHA1),
    encodeInt(5, DIGITS.SIX),
    encodeInt(6, OTP_TYPE.TOTP)
  ]);

  const payload = Buffer.concat([
    encodeFieldHeader(1, 2),
    encodeVarint(otp.length),
    otp,
    encodeInt(2, 1),
    encodeInt(3, 1),
    encodeInt(4, 0),
    encodeInt(5, batchId)
  ]);

  return `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`;
}

function generateQrImage(contents, outputPath) {
  const swiftSource = `
import Foundation
import CoreImage
import AppKit

let contents = ${JSON.stringify(contents)}
let outputPath = ${JSON.stringify(outputPath)}
let data = contents.data(using: .utf8)!
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(data, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
let image = filter.outputImage!.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
let rep = NSCIImageRep(ciImage: image)
let nsImage = NSImage(size: rep.size)
nsImage.addRepresentation(rep)
guard let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fatalError("Failed to create CGImage")
}
let bitmap = NSBitmapImageRep(cgImage: cgImage)
let outputUrl = URL(fileURLWithPath: outputPath)
try bitmap.representation(using: .png, properties: [:])!.write(to: outputUrl)
`;

  const scriptPath = `${outputPath}.swift`;
  writeFileSync(scriptPath, swiftSource);
  execFileSync('swift', [scriptPath], { stdio: 'pipe' });
}

test('CLI reads a migration URI from a file and prints Apple setup data', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-'));
  const inputPath = join(tempDir, 'migration.txt');
  writeFileSync(inputPath, buildMigrationUri());

  const output = execFileSync(
    'node',
    [cliPath, inputPath],
    { encoding: 'utf8' }
  );

  assert.match(output, /Decoded 1 account/);
  assert.match(output, /GitHub:alice@example.com/);
  assert.match(output, /Apple setup key: NBSWY3DP/);
});

test('CLI reads a QR image file and prints Apple setup data', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-'));
  const imagePath = join(tempDir, 'migration.png');
  generateQrImage(buildMigrationUri(), imagePath);

  const output = execFileSync(
    'node',
    [cliPath, imagePath],
    { encoding: 'utf8' }
  );

  assert.match(output, /Decoded 1 account/);
  assert.match(output, /GitHub:alice@example.com/);
  assert.match(output, /Apple setup key: NBSWY3DP/);
});

test('CLI reads a folder of QR images and prints all decoded accounts', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-'));
  const folderPath = join(tempDir, 'images');
  mkdirSync(folderPath);
  generateQrImage(
    buildMigrationUri({ secret: 'hello', name: 'alice@example.com', issuer: 'GitHub', batchId: 10 }),
    join(folderPath, 'b.png')
  );
  generateQrImage(
    buildMigrationUri({ secret: 'world', name: 'bob@example.com', issuer: 'Google', batchId: 11 }),
    join(folderPath, 'a.png')
  );

  const output = execFileSync(
    'node',
    [cliPath, folderPath],
    { encoding: 'utf8' }
  );

  assert.match(output, /Decoded 2 accounts/);
  assert.match(output, /1\. Google:bob@example\.com/);
  assert.match(output, /2\. GitHub:alice@example\.com/);
  assert.match(output, /Apple setup key: O5XXE3DE/);
  assert.match(output, /Apple setup key: NBSWY3DP/);
});

test('CLI can export decoded accounts to CSV and Markdown files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-'));
  const folderPath = join(tempDir, 'images');
  const csvPath = join(tempDir, 'accounts.csv');
  const markdownPath = join(tempDir, 'accounts.md');
  mkdirSync(folderPath);
  generateQrImage(
    buildMigrationUri({ secret: 'hello', name: 'alice@example.com', issuer: 'GitHub', batchId: 10 }),
    join(folderPath, 'first.png')
  );

  const output = execFileSync(
    'node',
    [
      cliPath,
      folderPath,
      '--csv',
      csvPath,
      '--md',
      markdownPath
    ],
    { encoding: 'utf8' }
  );

  assert.match(output, /Wrote CSV export:/);
  assert.match(output, /Wrote Markdown checklist:/);

  const csv = readFileSync(csvPath, 'utf8');
  assert.match(csv, /^label,issuer,name,secretBase32,type,algorithm,digits,counter,otpauthUrl$/m);
  assert.match(csv, /GitHub:alice@example\.com,GitHub,alice@example\.com,NBSWY3DP,TOTP,SHA1,6,,/);

  const markdown = readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /^# Google Authenticator Migration Checklist$/m);
  assert.match(markdown, /- \[ \] GitHub:alice@example\.com/);
  assert.match(markdown, /Setup key: `NBSWY3DP`/);
});

test('CLI uses folder_qr by default when no input argument is provided', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-'));
  const folderPath = join(tempDir, 'folder_qr');
  mkdirSync(folderPath);
  generateQrImage(
    buildMigrationUri({ secret: 'hello', name: 'alice@example.com', issuer: 'GitHub', batchId: 10 }),
    join(folderPath, 'default.png')
  );

  const output = execFileSync(
    'node',
    [cliPath],
    { encoding: 'utf8', cwd: tempDir }
  );

  assert.match(output, /Decoded 1 account/);
  assert.match(output, /GitHub:alice@example\.com/);
  assert.match(output, /Apple setup key: NBSWY3DP/);
});

test('CLI launched from src falls back to the project folder_qr directory', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ga2apple-project-'));
  const projectDir = join(tempDir, 'project');
  const projectSrcDir = join(projectDir, 'src');
  const projectQrDir = join(projectDir, 'folder_qr');
  cpSync(join(repoRoot, 'src'), projectSrcDir, { recursive: true });
  mkdirSync(projectQrDir, { recursive: true });
  generateQrImage(
    buildMigrationUri({ secret: 'hello', name: 'alice@example.com', issuer: 'GitHub', batchId: 10 }),
    join(projectQrDir, 'default.png')
  );

  const output = execFileSync(
    'node',
    ['./cli.js'],
    {
      encoding: 'utf8',
      cwd: projectSrcDir
    }
  );

  assert.match(output, /Decoded 1 account/);
  assert.match(output, /GitHub:alice@example\.com/);
});
