// Both engines execute extension operations on their existing SQLite connection.
import type BetterSqlite3 from 'better-sqlite3';
import type { NativeBinding } from './native.js';

export type SqlValue = string | number | null;
export interface SqlConnection {
  query<T>(sql: string, values?: readonly SqlValue[]): T[];
  execute(sql: string, values?: readonly SqlValue[]): number;
  transaction<T>(work: () => T): T;
}

export function extensionConnection(native: NativeBinding | null, handle: number | null,
  fallback?: BetterSqlite3.Database): SqlConnection {
  let depth = 0;
  const connection: SqlConnection = {
    query<T>(sql: string, values: readonly SqlValue[] = []): T[] {
      if (native && handle !== null) return JSON.parse(native.querySql(handle, sql, JSON.stringify(values)));
      return fallback!.prepare(sql).all(...values) as T[];
    },
    execute(sql: string, values: readonly SqlValue[] = []): number {
      if (native && handle !== null) return native.executeSql(handle, sql, JSON.stringify(values));
      return fallback!.prepare(sql).run(...values).changes;
    },
    transaction<T>(work: () => T): T {
      const nested = depth > 0;
      const name = `mimir_extension_${depth}`;
      connection.execute(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
      depth++;
      try {
        const result = work();
        connection.execute(nested ? `RELEASE ${name}` : 'COMMIT');
        return result;
      } catch (error) {
        connection.execute(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
        if (nested) connection.execute(`RELEASE ${name}`);
        throw error;
      } finally { depth--; }
    },
  };
  return connection;
}
