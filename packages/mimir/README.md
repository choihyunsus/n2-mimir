# n2-mimir 3.0.1

A local experience-learning library for AI agents. Mimir stores observations, derives reviewable insights, recalls relevant evidence, and records how those insights performed.

[한국어 안내](https://github.com/choihyunsus/n2-mimir/blob/v3.0.1/README.ko.md)

## SQLite runtime update

Version 3.0.1 upgrades the optional Rust engine to SQLite 3.54.1 and requires SQLite 3.51.3 or later at runtime. Install a current `better-sqlite3` 12.x driver. The minimum includes the upstream WAL-reset data-integrity fix. A deterministic isolated test reproduced data loss in the old native engine and verified committed-data preservation in both replacements. [SQLite release details](https://www.sqlite.org/releaselog/3_51_3.html)

## Install

Download `n2-mimir-3.0.1.tgz` from the GitHub release and install it with a supported SQLite driver.

```sh
npm install ./n2-mimir-3.0.1.tgz better-sqlite3@^12.8.0
```

Node.js 20.3 or later is required. Release checks run on Windows with Node.js 24.13. Both ESM and CommonJS exports include TypeScript declarations. The package uses `better-sqlite3` by default. An optional locally built Rust addon uses the same SQLite schema.

## Record, digest, recall

```js
import { Mimir } from 'n2-mimir';

const memory = new Mimir({ dbPath: './mimir.db', tokenBudget: 500 });
const scope = { project: 'demo', agent: 'worker' };
try {
  memory.deltaLearn({
    ...scope,
    type: 'failure',
    category: 'testing',
    context: 'Integration test',
    action: 'Run the test with the old configuration',
    outcome: 'The test failed',
    sourceRef: 'test-run-001',
    sessionId: 'session-001',
  });
  const result = await memory.digest(scope);
  console.log(result.collectionErrors, result.insightErrors);
  console.log(memory.overlay('integration test configuration', scope.project, scope.agent));
} finally {
  memory.close();
}
```

Supply a stable `sourceRef` for replayable observations and a new reference for a genuinely new observation. Identical referenced input reuses its stored record. Different outcomes remain separate. `digest` reports newly created insights and updated insights separately.

Mimir's learning changes stored experience, derived guidance and prompt context. The host selects which guidance to use. Pattern extraction and derivation checks run locally. Embeddings and web study are explicit optional operations.

## Durable study sessions

```js
const session = memory.study.start({
  ...scope, topic: 'SQLite recovery', sessionId: 'study-001',
});
memory.study.add(session.session.id, scope, {
  id: 'entry-001', topic: 'SQLite recovery',
  action: 'Restart after a committed write', outcome: 'The stored row survived',
  entryType: 'success', category: 'database',
});
const receipt = memory.study.end(session.session.id, scope);
```

Session state survives reopening the database. Repeating `end` returns the stored receipt. Conflicting entry replays fail. Observations, source links, derivation records and completion commit together. A session accepts up to 100 entries. `cancel` retains its recorded entries.

## Source-aware insights

The `n2-mimir/storage` entry exports `MimirDatabase` for direct storage operations. `insertInsight` accepts `sourceIds` and an explicit `project`. Linked evidence must belong to one project and the insight's agent.

Derived insights retain premise, reasoning, hypothesis, verification and conclusion records. Inspect them through `memory.reasoning.traceInsight(id)`. Strict stage order prevents new cyclic edges. The verification flag records deterministic evidence checks, including distinct premises and a linked success. Hosts still evaluate whether the conclusion is justified.

`memory.reasoning.invalidateEvidence(experienceId)` records invalidation, lowers downstream confidence and makes affected insights dormant. A later derivation continues to observe that invalidation. Historical observations and chains remain available. Automatic graduation checks derived verification results. Legacy manually authored insights continue to use their explicit votes and effect measurements.

`db.recordEffect(measurement, true)` stores a measurement and its optional vote atomically. An identical `(insightId, sessionId)` replay has no additional effect. Conflicting payloads fail. The host supplies the measurements.

## Soul integration and data contracts

Point Mimir at the same **Mimir database file** used by a distribution Soul 9.2 installation. Soul also has separate session files and other storage. Choose the actual configured Mimir path for that installation.

The shared `experiences`, `insights`, `tags`, `embeddings`, `effect_tracking`, `experience_insight_links`, `insight_links`, `tag_similarity` and `meta` tables use the existing Soul field names. Shared `schema_version` remains 2. Additive `mimir_*` study, reasoning and preview tables have separate version keys. Vector blobs use little-endian float32 values with the model identifier. New timestamps use UTC.

```js
import { LedgerAdapter } from 'n2-mimir';
memory.registerAdapter(new LedgerAdapter('/path/to/soul/data'));
await memory.digest(scope);
```

The adapter reads `projects/<project>/ledger/YYYY/MM/DD/*.json` and filters by project and agent. Session reports retain their reported status. JSONL input uses `JsonlAdapter`. `GenericAdapter` keeps observations until `acknowledge` after successful storage. `digest` handles that acknowledgment.

Daebung's existing prefixed tables and local-time dates require an explicit migration when integrating the standalone distributions. This release reads the distribution Soul contract directly.

## Additional operations

- `autoExtract(messages, scope, accept)` extracts keyword-classified candidates from user-role messages. The optional predicate lets the host apply its ingestion policy. Classification is available through `classifyMemory` and `extractCandidates`.
- `maintenance.browseInsights` provides scoped text search, pagination and totals over all matching rows. Set `sort` to `freshness` for category-sensitive temporal ranking.
- `maintenance.freshExperiences` ranks scoped observations before applying the result limit.
- `maintenance.mergeDuplicates` merges exact descriptions and summaries within one evidenced project and agent. Source records and retired duplicates remain traceable.
- `maintenance.archiveExperiences` adds bounded previews for mature linked observations. It processes up to 1,000 observations per call and retains the complete original text.

## Optional embeddings and web study

```js
const semanticMemory = new Mimir({
  dbPath: './mimir.db',
  llm: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    endpoint: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  },
});
```

The client supports OpenAI-compatible `/v1/embeddings` and Ollama `/api/embeddings` contracts. It validates vectors, bounds input and response sizes, limits cache entries, and rejects credential-bearing redirects. The Anthropic setting leaves embeddings inactive. Failed embedding requests fall back to lexical recall. API protocol references are available from [OpenAI](https://developers.openai.com/api/reference/resources/embeddings/methods/create) and [Ollama](https://github.com/ollama/ollama/blob/main/docs/api.md).

`autoStudy(topic, { project, agent })` searches DuckDuckGo HTML, crawls bounded pages, extracts claims and compares source hosts. Its legacy `verified` label means heuristic corroboration by at least three hosts. Factual review remains necessary. Contradictory and below-threshold results are excluded from learned observations. The host controls network access, trusted sources and model prompt integration. Search HTML can change independently of this package.

Overlay budgets use `ceil(text.length / 4)` as a character-based estimate. Use a model tokenizer in the host for a strict model-specific token ceiling.

## Build and verification

```sh
npm ci
npm run build
npm run typecheck
npm run test:ts
npm run build:native
npm run test:rust
```

Development tools require Node.js 22.18 or later. Rust builds require Rust 1.98 and platform C/C++ build tools. `build:native` creates a machine-specific addon for local development. Release archives contain the portable JavaScript build. See the [feature and verification map](https://github.com/choihyunsus/n2-mimir/blob/v3.0.1/docs/FEATURES.md) for test scope and integration boundaries.

## License

The repository's `LICENSE` specifies custom noncommercial and commercial licensing terms. Package metadata points to that file. Read it together with `LICENSE-APACHE` and `THIRD-PARTY-NOTICES`. Daebung-derived portions retain their MIT notices. The Rust core's declared license is MIT.
