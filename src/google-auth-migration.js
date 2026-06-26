const ALGORITHM_NAMES = new Map([
  [0, 'SHA1'],
  [1, 'SHA1'],
  [2, 'SHA256'],
  [3, 'SHA512'],
  [4, 'MD5']
]);

const DIGIT_COUNTS = new Map([
  [0, 6],
  [1, 6],
  [2, 8]
]);

const OTP_TYPES = new Map([
  [0, 'TOTP'],
  [1, 'HOTP'],
  [2, 'TOTP']
]);

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeBase64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }
  return normalized + '='.repeat(4 - padding);
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length) {
    const byte = BigInt(buffer[index]);
    result |= (byte & 0x7fn) << shift;
    index += 1;

    if ((byte & 0x80n) === 0n) {
      return { value: Number(result), offset: index };
    }

    shift += 7n;
  }

  throw new Error('Unexpected end of protobuf varint');
}

function readLengthDelimited(buffer, offset) {
  const { value: length, offset: afterLength } = readVarint(buffer, offset);
  const end = afterLength + length;
  if (end > buffer.length) {
    throw new Error('Length-delimited field exceeds payload size');
  }
  return { value: buffer.subarray(afterLength, end), offset: end };
}

function skipField(buffer, offset, wireType) {
  if (wireType === 0) {
    return readVarint(buffer, offset).offset;
  }

  if (wireType === 2) {
    return readLengthDelimited(buffer, offset).offset;
  }

  if (wireType === 1) {
    return offset + 8;
  }

  if (wireType === 5) {
    return offset + 4;
  }

  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function decodeOtpParameters(buffer) {
  const entry = {
    secret: Buffer.alloc(0),
    name: '',
    issuer: '',
    algorithm: 0,
    digits: 0,
    type: 0,
    counter: null
  };

  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;

    if (fieldNumber === 1 && wireType === 2) {
      const field = readLengthDelimited(buffer, offset);
      entry.secret = field.value;
      offset = field.offset;
      continue;
    }

    if (fieldNumber === 2 && wireType === 2) {
      const field = readLengthDelimited(buffer, offset);
      entry.name = field.value.toString('utf8');
      offset = field.offset;
      continue;
    }

    if (fieldNumber === 3 && wireType === 2) {
      const field = readLengthDelimited(buffer, offset);
      entry.issuer = field.value.toString('utf8');
      offset = field.offset;
      continue;
    }

    if (fieldNumber >= 4 && fieldNumber <= 7 && wireType === 0) {
      const field = readVarint(buffer, offset);
      if (fieldNumber === 4) entry.algorithm = field.value;
      if (fieldNumber === 5) entry.digits = field.value;
      if (fieldNumber === 6) entry.type = field.value;
      if (fieldNumber === 7) entry.counter = field.value;
      offset = field.offset;
      continue;
    }

    offset = skipField(buffer, offset, wireType);
  }

  return entry;
}

function decodeMigrationPayload(buffer) {
  const payload = {
    entries: [],
    version: null,
    batchSize: null,
    batchIndex: null,
    batchId: null
  };

  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;

    if (fieldNumber === 1 && wireType === 2) {
      const field = readLengthDelimited(buffer, offset);
      payload.entries.push(decodeOtpParameters(field.value));
      offset = field.offset;
      continue;
    }

    if (fieldNumber >= 2 && fieldNumber <= 5 && wireType === 0) {
      const field = readVarint(buffer, offset);
      if (fieldNumber === 2) payload.version = field.value;
      if (fieldNumber === 3) payload.batchSize = field.value;
      if (fieldNumber === 4) payload.batchIndex = field.value;
      if (fieldNumber === 5) payload.batchId = field.value;
      offset = field.offset;
      continue;
    }

    offset = skipField(buffer, offset, wireType);
  }

  return payload;
}

function toBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

function buildLabel(issuer, name) {
  if (issuer && name) {
    return name.startsWith(`${issuer}:`) ? name : `${issuer}:${name}`;
  }
  return issuer || name || 'Unnamed account';
}

function buildOtpAuthUrl(entry) {
  const type = entry.type.toLowerCase();
  const label = encodeURIComponent(entry.label);
  const params = new URLSearchParams();
  params.set('secret', entry.secretBase32);

  if (entry.issuer) {
    params.set('issuer', entry.issuer);
  }

  params.set('algorithm', entry.algorithm);
  params.set('digits', String(entry.digits));

  if (entry.type === 'HOTP' && entry.counter !== null) {
    params.set('counter', String(entry.counter));
  }

  return `otpauth://${type}/${label}?${params.toString()}`;
}

function hydrateEntry(entry) {
  const hydrated = {
    secretBase32: toBase32(entry.secret),
    name: entry.name,
    issuer: entry.issuer,
    algorithm: ALGORITHM_NAMES.get(entry.algorithm) ?? 'SHA1',
    digits: DIGIT_COUNTS.get(entry.digits) ?? 6,
    type: OTP_TYPES.get(entry.type) ?? 'TOTP',
    counter: entry.counter,
    label: buildLabel(entry.issuer, entry.name)
  };

  return {
    ...hydrated,
    otpauthUrl: buildOtpAuthUrl(hydrated)
  };
}

export function parseMigrationUri(input) {
  const trimmed = input.trim();

  if (!trimmed.startsWith('otpauth-migration://')) {
    throw new Error('Expected an otpauth-migration URI');
  }

  const url = new URL(trimmed);
  const data = url.searchParams.get('data');

  if (!data) {
    throw new Error('Migration URI is missing the data query parameter');
  }

  const payloadBuffer = Buffer.from(normalizeBase64(data), 'base64');
  const payload = decodeMigrationPayload(payloadBuffer);

  return {
    version: payload.version,
    batchSize: payload.batchSize,
    batchIndex: payload.batchIndex,
    batchId: payload.batchId,
    entries: payload.entries.map(hydrateEntry)
  };
}
