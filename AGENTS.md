# AGENTS.md

Project-level agent guidance for `claude-context`.

## Repo Identity

This codebase originated from `zilliztech/claude-context` but is now an independent repository under `lbruton/claude-context`.

- `origin` (`lbruton/claude-context`) is canonical for all day-to-day work
- `upstream` (`zilliztech/claude-context`) can remain configured for historical reference only
- Upstream presence in `git remote -v` does not mean PRs should target or be resolved there

## PR Resolve Guardrail

To avoid cross-repo confusion during `/pr-resolve`:

- Always run PR discovery/checks against `-R lbruton/claude-context`
- Treat PR numbers as repo-scoped (e.g., `#5` in upstream is unrelated)
- If both repos have the same PR number, prefer `origin` unless the user explicitly asks for upstream

## Branch Baseline

- Default branch is `master` (not `main`)
