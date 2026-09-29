---
tags: []
doc_type: overview
project: claude-context
source: manual
created: "2026-04-02"
updated: "2026-04-02"
---

# claude-context

> **Public copy.** Deployment and infra details (hosts, IPs, ports) are in the private companion: `Devops/DocVault/Projects/claude-context/Overview.md` (`vault-path private`).

Fork of [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — patched for local Milvus stability. Published as `@lbruton/claude-context-core` and `@lbruton/claude-context-mcp` on npm.

## At a Glance

| Field | Value |
|-------|-------|
| Repo | [lbruton/claude-context](https://github.com/lbruton/claude-context) |
| Language | TypeScript (pnpm monorepo) |
| Branches | `master` (single branch) |
| Version Lock | None — version in 3x `package.json` files |
| npm Packages | `@lbruton/claude-context-core`, `@lbruton/claude-context-mcp` |
| Upstream | `zilliztech/claude-context` |

## Fork Changes (v0.1.9)

1. **30s fetch timeout** on all REST API requests (`AbortSignal.timeout`)
2. **30s gRPC connection timeout** on `MilvusClient` initialization
3. **Better error logging** — timeout vs error differentiated in log output
4. **Rebranded to `@lbruton/` npm scope**
5. **Zilliz Cloud fallback removed** — `zilliz-utils.ts` deleted, no cloud API calls
6. **Connection retry with exponential backoff** — 5 attempts (2s-32s) on gRPC/REST errors during init
7. **Health check on startup** — verifies Milvus is reachable before accepting MCP clients

## Architecture

Two packages in `packages/`:

- **core** (`@lbruton/claude-context-core`, CommonJS) — Indexing engine: code splitting (tree-sitter AST), embedding (OpenAI/VoyageAI/Gemini/Ollama), vector storage (Milvus gRPC + REST), incremental sync (MerkleDAG)
- **mcp** (`@lbruton/claude-context-mcp`, ESM) — MCP server exposing `index_codebase`, `search_code`, `clear_index`, `get_indexing_status` over stdio

## Infrastructure

