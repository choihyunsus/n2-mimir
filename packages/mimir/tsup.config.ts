// Build explicit ESM/CJS entries and use the native CJS loader in that output.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/store/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['better-sqlite3'],
  esbuildOptions(options, context) {
    if (context.format === 'cjs') options.define = { ...options.define, 'import.meta.url': 'undefined' };
  },
});
