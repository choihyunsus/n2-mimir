// Build the optional addon for this machine, then place it in both supported local layouts.
const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const result = spawnSync('cargo', ['+1.98.0', 'build', '--release', '--locked', '--jobs', '2',
  '--manifest-path', join(root, 'packages/core/Cargo.toml')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const names = { win32: 'n2_mimir_core.dll', darwin: 'libn2_mimir_core.dylib', linux: 'libn2_mimir_core.so' };
const name = names[process.platform];
if (!name) throw new Error(`Unsupported native build platform ${process.platform}`);
const binary = join(root, 'packages/core/target/release', name);
if (!existsSync(binary)) throw new Error('Native output missing; use the default host build target');
const output = join(root, 'packages/mimir/dist');
mkdirSync(output, { recursive: true });
copyFileSync(binary, join(root, 'packages/core/n2-mimir-core.node'));
copyFileSync(binary, join(output, 'n2-mimir-core.node'));
console.log('Built native addon for', process.platform, process.arch);
