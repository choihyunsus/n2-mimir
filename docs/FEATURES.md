# Feature and verification map

## Standalone APIs

| Daebung capability | Distribution entry point | Evidence |
|---|---|---|
| Experience logging, normalization, replay | `addExperience`, `deltaLearn`, adapters | storage, normalization, replay and input-contract tests |
| Project and agent isolation | scoped recall and storage filters | scope regression, provenance and native ABI probe |
| Contrast and repeated-pattern learning | `digest` | analyzer and end-to-end simulations |
| Linked insights and voting | `MimirDatabase.insertInsight`, `reinforceInsight` | provenance and nested rollback tests |
| Derivation atoms and chains | `reasoning` | graph ordering, ownership, replay and complete rollback |
| Evidence invalidation | `reasoning.invalidateEvidence` | persistent invalidation and downstream confidence tests |
| Structured study | `study.start/add/end/cancel` | restart, completion replay, scope and injected flush failure |
| User-message extraction | `autoExtract` | role filtering, explicit scope, policy predicate and replay |
| Web study | `autoStudy` | search HTML fixtures through crawl, extraction, corroboration and storage |
| Temporal priority | `freshnessWeight`, maintenance freshness queries | UTC, future date, category decay and limit-order tests |
| Conservative duplicate merge | `maintenance.mergeDuplicates` | exact text, scope, contrary advice and provenance retention |
| Evidence previews | `maintenance.archiveExperiences` | valid bounded JSON and complete source preservation |
| Insight browsing and statistics | `maintenance.browseInsights` | all-match totals with scoped pagination |
| Prompt overlay | `overlay`, `assemble` | tiny budgets, rendered size and selected IDs |
| Effect measurement | `MimirDatabase.recordEffect` | replay, conflict, atomic vote and rollback |
| Optional semantic search | explicit embedding configuration | native/fallback vectors, provider HTTP contracts and scope tests |

The distribution adapts Daebung learning components to the existing distribution Soul schema. Product-specific UI, HTTP routing, private ingestion policy, automatic host lifecycle registration and security-policy generation belong to their respective integrations. Callable Soul host helpers and tool descriptors are included. The host supplies registration and authorization.

## Shared database

The nine common data tables retain the distribution Soul 9.2 schema. Mimir owns additive reasoning, study, invalidation and preview tables. Supplemental insight FTS indexes track the common `insights` table.

Extension keys in `meta` version reasoning, study and maintenance independently. Initialization and migration run inside transactions. A newer common or extension schema causes an explicit error.

The integration probe opens the same isolated database with the actual Soul 9.2 store, the TypeScript backend and the Rust addon. It checks common column definitions, two-process writes, readback after reopening, vector bytes/model identifiers and rollback when a newer common schema is encountered.

## Test boundaries

- The TypeScript suite exercises both storage implementations independently. Its backend contract test checks the selected engine when `MIMIR_TEST_BACKEND` is set.
- Native verification uses the compiled Node addon and Rust unit tests. The optional release build is generated for the current Windows x64 machine.
- HTTP tests use local isolated endpoints. Web study uses deterministic HTML fixtures. Provider availability, search-result quality and model embedding quality require evaluation in the deployment environment.
- Derivation verification checks source structure and recorded evidence. The host reviews a conclusion's meaning and current applicability.
- Archive previews preserve source text. Existing prefixed Daebung databases need a separately tested mapping before application migration.
- Project/agent filters establish data ownership within the library. The host supplies authenticated identity, network policy and execution permissions.

## Migration from 2.x

- Package exports include `n2-mimir/storage`, with declarations for ESM and CommonJS.
- Embeddings start when an endpoint and supported model are explicitly configured.
- Identical observations with stable source references replay idempotently. Distinct outcomes remain separate.
- Automatic repeated-digest voting requires new evidence. Exact matching preserves differing advice.
- `GenericAdapter.collect` retains its buffer until acknowledgment. `digest` acknowledges successfully processed collections.
- Legacy project insights without linked provenance are excluded from scoped project recall.
- Failed derivation checks block automatic graduation of derived insights. Direct manual insight operations retain their host-managed semantics.
- `digest` includes collection and insight errors and separates created and updated counts.
- Search accepts bounded literal tokens and optional `OR` separators. Read limits are bounded at the public storage entry points.
- Development uses Vitest 5 and tsup 9, requiring Node.js 22.18 or later. Runtime minimum is Node.js 20.3.

한국어 안내

대붕이의 학습 기능을 배포판 Soul의 공통 저장 구조에 맞춰 옮겼습니다. 위 표에서 기능별 API와 실제 검증 범위를 확인할 수 있습니다. 호스트의 UI·권한·수명주기 연결과 기존 대붕이 DB 마이그레이션은 각 통합 작업에서 수행해야 합니다. 의미 판단과 모델 품질은 배포 환경에서 추가 평가가 필요합니다.
