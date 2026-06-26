import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMigrationUri } from '../src/google-auth-migration.js';

const ALGORITHM = {
  ALGORITHM_UNSPECIFIED: 0,
  SHA1: 1,
  SHA256: 2,
  SHA512: 3,
  MD5: 4
};

const DIGITS = {
  DIGIT_COUNT_UNSPECIFIED: 0,
  SIX: 1,
  EIGHT: 2
};

const OTP_TYPE = {
  OTP_TYPE_UNSPECIFIED: 0,
  HOTP: 1,
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

function encodeOtpParameters({
  secret,
  name,
  issuer,
  algorithm,
  digits,
  type,
  counter
}) {
  const fields = [
    encodeBytes(1, secret),
    encodeBytes(2, name),
    encodeBytes(3, issuer),
    encodeInt(4, algorithm),
    encodeInt(5, digits),
    encodeInt(6, type)
  ];

  if (counter !== undefined) {
    fields.push(encodeInt(7, counter));
  }

  return Buffer.concat(fields);
}

function buildMigrationUri({ entries, version = 1, batchSize = entries.length, batchIndex = 0, batchId = 1 }) {
  const payload = [];

  for (const entry of entries) {
    const message = encodeOtpParameters(entry);
    payload.push(encodeFieldHeader(1, 2), encodeVarint(message.length), message);
  }

  payload.push(encodeInt(2, version));
  payload.push(encodeInt(3, batchSize));
  payload.push(encodeInt(4, batchIndex));
  payload.push(encodeInt(5, batchId));

  const base64 = Buffer.concat(payload).toString('base64');
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

test('parseMigrationUri decodes multiple OTP entries and preserves metadata', () => {
  const uri = buildMigrationUri({
    version: 1,
    batchSize: 2,
    batchIndex: 0,
    batchId: 42,
    entries: [
      {
        secret: Buffer.from('hello'),
        name: 'alice@example.com',
        issuer: 'GitHub',
        algorithm: ALGORITHM.SHA1,
        digits: DIGITS.SIX,
        type: OTP_TYPE.TOTP
      },
      {
        secret: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        name: 'deploy-bot',
        issuer: 'Internal',
        algorithm: ALGORITHM.SHA256,
        digits: DIGITS.EIGHT,
        type: OTP_TYPE.HOTP,
        counter: 7
      }
    ]
  });

  const parsed = parseMigrationUri(uri);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.batchSize, 2);
  assert.equal(parsed.batchIndex, 0);
  assert.equal(parsed.batchId, 42);
  assert.equal(parsed.entries.length, 2);

  assert.deepEqual(parsed.entries[0], {
    secretBase32: 'NBSWY3DP',
    name: 'alice@example.com',
    issuer: 'GitHub',
    algorithm: 'SHA1',
    digits: 6,
    type: 'TOTP',
    counter: null,
    label: 'GitHub:alice@example.com',
    otpauthUrl: 'otpauth://totp/GitHub%3Aalice%40example.com?secret=NBSWY3DP&issuer=GitHub&algorithm=SHA1&digits=6'
  });

  assert.deepEqual(parsed.entries[1], {
    secretBase32: '32W353Y',
    name: 'deploy-bot',
    issuer: 'Internal',
    algorithm: 'SHA256',
    digits: 8,
    type: 'HOTP',
    counter: 7,
    label: 'Internal:deploy-bot',
    otpauthUrl: 'otpauth://hotp/Internal%3Adeploy-bot?secret=32W353Y&issuer=Internal&algorithm=SHA256&digits=8&counter=7'
  });
});

test('parseMigrationUri rejects non-migration URIs', () => {
  assert.throws(
    () => parseMigrationUri('otpauth://totp/Example:test?secret=AAAA'),
    /Expected an otpauth-migration URI/
  );
});
