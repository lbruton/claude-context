# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Fork of [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — patched for local Milvus stability. Published as `@lbruton/claude-context-core` and `@lbruton/claude-context-mcp` on npm.

Key fork changes: 30s fetch/gRPC timeouts, better error differentiation, rebranded to `@lbruton/` npm scope.

**DocVault:** Start at `/Volumes/DATA/GitHub/DocVault/Projects/claude-context/_Index.md` and follow the index. mem0 supplements with session context.
**Issue prefix:** `CFLOW-` — tracked in Plane: <https://plane.lbruton.cc/lbruton/projects/593cfea0-1859-425a-af27-d029b30d43e1/>. Pre-migration DocVault issues archived at `DocVault/Archive/Issues-Pre-Plane/claude-context/`.
**Branch:** `master` (not main).

## Repository Identity (Important)

This repository started as a fork of `zilliztech/claude-context`, but it is now maintained as an independent project.

- `origin` is the source of truth for all PR work: `lbruton/claude-context`
- `upstream` may still exist as a remote for occasional reference/contribution history
- Treat upstream PRs/issues as actionable for this repo only when explicitly requested by the user.
- For PR operations (especially `/pr-resolve`), always scope GitHub calls to `owner: "lbruton"`, `repo: "claude-context"` via `mcp__github__*` tools (per user-level CLAUDE.md "GitHub MCP vs `gh` CLI"). Only fall back to `gh -R lbruton/claude-context` for the MCP gaps listed there (GraphQL `resolveReviewThread`, `gh pr ready`, `gh release create`, review-thread replies).

## Build & Dev Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm build                # Build all packages (core first, then mcp)
pnpm build:core           # Build only @lbruton/claude-context-core
pnpm build:mcp            # Build only @lbruton/claude-context-mcp
pnpm dev:core             # Watch mode for core
pnpm dev:mcp              # Watch mode for mcp (tsx)
pnpm lint                 # Lint all packages
pnpm lint:fix             # Auto-fix lint issues
pnpm typecheck            # Type-check without emitting
pnpm clean                # Remove all dist/ directories
```

### Publishing

```bash
pnpm release:core         # Build core chain + publish to npm
pnpm release:mcp          # Build mcp chain + publish to npm
```

Both versions must be bumped in sync: root `package.json`, `packages/core/package.json`, and `packages/mcp/package.json` (currently `0.1.10`).

## Architecture

### Monorepo Layout (pnpm workspaces)

- **`packages/core`** — Indexing engine (`@lbruton/claude-context-core`, CommonJS)
- **`packages/mcp`** — MCP server (`@lbruton/claude-context-mcp`, ESM, depends on core via `workspace:*`)

### Core Package (`packages/core/src/`)

The `Context` class (`context.ts`) is the main entry point. It orchestrates:

- **Splitters** (`splitter/`) — Break source files into chunks. `AstCodeSplitter` uses tree-sitter for syntax-aware splitting (supports TS/JS/Python/Java/Go/Rust/C++/C#/Scala). Falls back to `LangChainSplitter` for unsupported languages.
- **Embeddings** (`embedding/`) — Generate vectors from code chunks. Providers: OpenAI (default), VoyageAI, Gemini, Ollama. All extend `BaseEmbedding`.
- **VectorDB** (`vectordb/`) — Store/search embeddings in Milvus. Two implementations: `MilvusVectorDatabase` (gRPC via `@zilliz/milvus2-sdk-node`) and `MilvusRestfulVectorDatabase` (REST API). Supports hybrid search (dense + BM25).
- **Sync** (`sync/`) — `FileSynchronizer` uses a `MerkleDAG` to detect file changes (added/modified/removed) for incremental re-indexing. Snapshots stored in `~/.context/merkle/`.

### MCP Package (`packages/mcp/src/`)

Stdio-based MCP server exposing 4 tools: `index_codebase`, `search_code`, `clear_index`, `get_indexing_status`.

Key modules:

- `index.ts` — Server entry point. Redirects console.log/warn to stderr (critical for MCP JSON protocol on stdout).
- `config.ts` — Reads env vars into `ContextMcpConfig`.
- `handlers.ts` — Tool implementations.
- `sync.ts` — `SyncManager` runs background incremental sync for indexed codebases.
- `snapshot.ts` — `SnapshotManager` persists indexing state to `~/.context/codebase-snapshot.json`.

### Data Flow

1. `index_codebase` → Context splits files → embeds chunks → upserts to Milvus collection (named by hashed path)
2. `search_code` → embeds query → vector similarity search in Milvus → returns ranked code snippets with file paths and line numbers
3. Background sync → MerkleDAG diffs → re-indexes only changed files

## Important Constraints

- **Console output**: In the MCP package, `console.log` and `console.warn` are redirected to stderr. Only MCP protocol JSON goes to stdout. Use `console.log` and `console.warn` for logging output; reserve stdout exclusively for MCP protocol JSON.
- **Core is CommonJS, MCP is ESM**: Core uses `"module": "commonjs"` (tsconfig), MCP uses `"type": "module"` (package.json). Imports in MCP must use `.js` extensions.
- **Node >=20, pnpm >=10**: Enforced in `engines` field.
- **CI**: GitHub Actions runs lint + build on ubuntu/windows with Node 20.x/22.x. Lint step is currently commented out in CI.

## Required Environment Variables

| Variable             | Required | Notes                                      |
| -------------------- | -------- | ------------------------------------------ |
| `MILVUS_ADDRESS`     | Yes      | gRPC endpoint (e.g., `192.168.1.81:19530`) |
| `OPENAI_API_KEY`     | Yes\*    | \*When using OpenAI embeddings (default)   |
| `EMBEDDING_PROVIDER` | No       | `OpenAI`, `VoyageAI`, `Gemini`, `Ollama`   |
| `EMBEDDING_MODEL`    | No       | Default: `text-embedding-3-small`          |

## Hooks

- **gitleaks**: Pre-commit hook scans for accidental secret commits (`github-pat`, `aws`, `stripe`, etc.). Runs via `pre-commit` framework. Installed 2026-04-14 (OPS-116).
