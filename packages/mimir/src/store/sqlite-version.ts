// Verify the runtime engine before initializing a writable shared database.
export function isSupportedSqliteVersion(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) return false;
  const [major = 0, minor = 0, patch = 0] = value.split('.').map(Number);
  return major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)));
}

export function assertSupportedSqliteVersion(value: unknown): void {
  if (!isSupportedSqliteVersion(value)) {
    throw new Error(`SQLite 3.51.3 or later is required for WAL-reset fixes; found ${String(value)}`);
  }
}
