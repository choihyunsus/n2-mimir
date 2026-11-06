# Rust core

Optional Node addon for SQLite, FTS5 and vector operations. The binding contract is version 3. The managed API shares extension logic across this addon and better-sqlite3.

From the repository root, run `npm run build` followed by `npm run build:native`. Rust 1.98 and a platform C/C++ toolchain are required. The build helper copies the local addon into development and built-package layouts. Outputs are machine-specific and excluded from portable release archives.

Run `npm run test:rust` for Rust unit tests. Also run the TypeScript suite against the actual addon to verify its Node interface.

한국어 안내

선택적으로 빌드하는 Node 애드온입니다. Rust 1.98과 플랫폼 C/C++ 빌드 도구를 준비한 후 저장소 루트에서 위 명령을 실행하세요. 로컬 기기용 바이너리는 실제 검증에 사용하며, 이식 가능한 배포 압축에는 JavaScript 빌드를 제공합니다.
