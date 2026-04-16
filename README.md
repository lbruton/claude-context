# @lbruton/claude-context

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/6be742df2b9347efa36fa7befbb04c95)](https://app.codacy.com/gh/lbruton/claude-context/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

> Actively maintained fork of [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — hardened for self-hosted Milvus deployments.

## Why this fork?

The upstream `@zilliz/claude-context-mcp` targets Zilliz Cloud. When used with self-hosted Milvus it has several issues:

- **No fetch/gRPC timeout** — hangs indefinitely on `DEADLINE_EXCEEDED`
- **Zilliz Cloud fallback** — silently falls back to cloud on any connection error, masking local Milvus failures
- **No retry logic** — a single transient failure aborts the entire indexing run
- **No error differentiation** — timeout vs auth vs connection failure all look the same
- **Carries unused packages** — chrome extension, VS Code extension, and evaluation suite add attack surface without value for MCP-only deployments
- **Ignore file accumulation** — `.dockerignore`, `.npmignore` etc. loaded alongside `.gitignore`, causing patterns like `*.md` to bleed across repos indexed in the same session

This fork strips it down to core + MCP server, patches all known issues, and publishes to `@lbruton/` on npm.

## Changes from upstream

### Reliability (CC-1)

1. **Removed Zilliz Cloud fallback** — failed Milvus connections surface as errors immediately, no silent cloud redirect
2. **Retry with exponential backoff** — transient `DEADLINE_EXCEEDED` and connection errors retry automatically before failing
3. **Health check on startup** — Milvus connectivity verified at server init with a clear error if unreachable
4. **30s fetch + gRPC timeouts** — no more indefinite hangs on REST or gRPC calls
5. **Hardened snapshot validation** — safety guards prevent corrupted state files from breaking subsequent runs

### Indexing correctness (CC-2 — v0.1.13)

6. **Allowlist for ignore files** — only `.gitignore` and `.contextignore` are loaded; `.dockerignore`, `.npmignore`, and other tool-specific files are excluded. Prevents patterns like `*.md` from a Docker ignore file bleeding into unrelated repos indexed in the same session.
7. **Negation line filtering** — `!`-prefixed lines in `.gitignore` are stripped rather than passed as positive rules to the glob engine, preventing false exclusions.

### Cleaner MCP startup (CC-3 — v0.1.13)

8. **Removed debug logs** — `[DEBUG]` lines that dumped environment variable names (including API key presence) to stderr on every startup have been removed from `config.ts`.

### Security hardening (v0.1.8)

9. **Removed unused packages** — chrome extension, VS Code extension, and `evaluation/` benchmark suite eliminated along with their vulnerable dependency trees
10. **Patched all dependencies** — 67 audit vulnerabilities resolved (0 remaining)
11. **pnpm overrides** for transitive deps pinned by upstream packages
12. **Codacy SCA/SAST clean** — `.codacy.yml` configured, false positives suppressed

### Scope

13. **Rebranded to `@lbruton/` npm scope** — `@lbruton/claude-context-core` + `@lbruton/claude-context-mcp`
14. **Lean monorepo** — only `packages/core` and `packages/mcp` remain in the workspace

## Installation (Claude Code MCP)

In `~/.claude/.mcp.json`:

```json
{
    "mcpServers": {
        "claude-context": {
            "command": "npx",
            "args": ["-y", "@lbruton/claude-context-mcp@latest"],
            "env": {
                "OPENAI_API_KEY": "sk-...",
                "EMBEDDING_PROVIDER": "OpenAI",
                "EMBEDDING_MODEL": "text-embedding-3-small",
                "MILVUS_ADDRESS": "192.168.1.81:19530"
            },
            "startupTimeoutMs": 30000
        }
    }
}
```

## Environment Variables

| Variable             | Required | Description                                                          |
| -------------------- | -------- | -------------------------------------------------------------------- |
| `MILVUS_ADDRESS`     | Yes      | Milvus gRPC endpoint — bare `host:port` (e.g., `192.168.1.81:19530`) |
| `OPENAI_API_KEY`     | Yes\*    | API key for OpenAI embeddings                                        |
| `EMBEDDING_PROVIDER` | No       | `OpenAI` (default), `VoyageAI`, `Gemini`, `Ollama`                   |
| `EMBEDDING_MODEL`    | No       | Model name (default: `text-embedding-3-small`)                       |
| `MILVUS_TOKEN`       | No       | Authentication token for Milvus (if auth enabled)                    |
| `VOYAGEAI_API_KEY`   | No       | Required when `EMBEDDING_PROVIDER=VoyageAI`                          |
| `GEMINI_API_KEY`     | No       | Required when `EMBEDDING_PROVIDER=Gemini`                            |
| `OLLAMA_HOST`        | No       | Ollama server host (default: `http://127.0.0.1:11434`)               |
| `OLLAMA_MODEL`       | No       | Ollama model name (alternative to `EMBEDDING_MODEL` for Ollama)      |

\*Required when using OpenAI embeddings (default).

## Custom ignore patterns

By default only `.gitignore` and `.contextignore` are loaded. To exclude files or directories from indexing without modifying your `.gitignore`, add a `.contextignore` file at the root of the codebase:

```
# .contextignore
dist/
*.generated.ts
secrets/
```

## Local Milvus setup

This fork is designed for local Milvus Standalone. Run Milvus via Docker:

```bash
docker compose -f docker-compose-milvus.yml up -d
```

Or point `MILVUS_ADDRESS` at an existing Milvus instance on your network.

## Building from source

```bash
pnpm install
pnpm build:core
pnpm build:mcp
```

## Publishing

```bash
pnpm release:core
pnpm release:mcp
```

## License

MIT — same as upstream.

## Upstream

Original project by [Zilliz](https://zilliz.com): [zilliztech/claude-context](https://github.com/zilliztech/claude-context). This fork diverges in scope (MCP-only, self-hosted Milvus) but the core indexing engine and MCP protocol implementation remain theirs.
