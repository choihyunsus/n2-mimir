// SQLite vectors use portable little-endian IEEE-754 float32 bytes.
export function encodeVector(vector: readonly number[]): Buffer {
  if (!vector.length || vector.length > 65536 || vector.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
    throw new Error('Vector requires 1-65536 finite float32 values');
  }
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

export function decodeVector(bytes: Buffer): number[] {
  if (!bytes.length || bytes.length % 4 !== 0 || bytes.length > 65536 * 4) throw new Error('Invalid vector encoding');
  const vector = Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readFloatLE(index * 4));
  if (vector.some(value => !Number.isFinite(value))) throw new Error('Invalid vector value');
  return vector;
}
