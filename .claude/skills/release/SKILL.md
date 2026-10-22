---
name: release
description: Release workflow — version lock, worktree, bump, commit, PR, GitHub Release. Delegates to project overrides.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
library-version: 58c5a7a41a16
---

# Release — Universal Version Lock Workflow

Project-agnostic release orchestrator. Handles the version lock protocol, worktree lifecycle,
PR creation, and GitHub Release. **Delegates the actual file edits (Phase 1) to the project-level
`release/SKILL.md`** if one exists — otherwise uses sensible defaults.

## When to Run

**`patch`** — bump PATCH number after every meaningful committed change. Default dev workflow.
**`release`** — bump RELEASE/MINOR number when shipping a major batch to main.

## Arguments

$ARGUMENTS can be:
- `release` — bump RELEASE number (e.g., 3.23.01 → 3.24.00, or 0.2.3 → 0.3.0)
- `patch` — bump PATCH number (e.g., 3.23.01 → 3.23.02, or 0.2.3 → 0.2.4)
- `dry-run` — preview all changes without writing
- If no argument provided, ask the user whether this is a `release` or `patch`.

## Phase 0: Gather Context

### Step 0.0: Read Project Identity

Use the `Read` tool on `.claude/project.json`.

Extract `name`, `tag`, `issuePrefix`. These are used throughout:
- `issuePrefix` → issue references in commits and PRs (e.g., STAK-55, FORGE-82)
- `plane.projectId` → Plane issue lookups (`mcp__plane__*`)
- `tag` → used in commit messages and lock file entries

Determine the **PR target branch**:
- If the repo has a `dev` branch: patches PR to `dev`, releases ship `dev → main`
- If no `dev` branch: patches PR to `main` directly

```bash
git branch -a | grep -q 'remotes/origin/dev' && echo "TARGET=dev" || echo "TARGET=main"
```

### Step 0.1: Remote Sync Gate (HARD GATE)

Before claiming a version lock or creating a worktree, ensure local branch matches remote.

```bash
git fetch origin
TARGET_BRANCH=$(git branch -a | grep -q 'remotes/origin/dev' && echo dev || echo main)
BEHIND=$(git rev-list HEAD..origin/$TARGET_BRANCH --count)
```

**If `BEHIND` is 0:** Continue. **If `BEHIND` > 0:** HARD STOP.

```
Local $TARGET_BRANCH is N commits behind origin/$TARGET_BRANCH.
Run: git pull origin $TARGET_BRANCH
Then re-run /release patch.
```

### Step 0.2: Version Lock Claim (REQUIRED)

The lock file uses a **claims array** — multiple agents can hold concurrent claims on
different version numbers.

**0. Idempotency check (IF NOT ALREADY DONE):**

If this session already set up the lock + worktree — e.g. handed off from `/start-patch`, or a
prior `/release` invocation in the same session — do NOT re-claim. Check `devops/version.lock`
for an **unexpired** claim whose `issue` / `claimed_by` matches the current work, AND a worktree
for that version carrying a fresh `.worktree.lock` you own. If both exist, SKIP steps 1–5 and
continue inside that worktree. Run steps 1–5 only when no matching active claim + worktree exists.

**1. Read and prune expired claims:**

Use the `Read` tool on `devops/version.lock`. If file not found, treat as unlocked.

Parse the `claims` array. Remove entries where `expires_at` or `claimedAt` is older than
30 minutes. Write the pruned file back if anything was removed.

**2. Compute your version:**

- Find the highest `version` value in the remaining active claims
- If no active claims exist, read the current version from `devops/version.lock` top-level
  `version` field, or fall back to `package.json` `version`, or `js/constants.js` `APP_VERSION`
- Increment based on argument:
  - `patch` → increment last component (0.2.3 → 0.2.4)
  - `release` → increment middle component, reset last to 0 (0.2.3 → 0.3.0)

**3. Append your claim and write the file:**

```json
{
  "version": "NEW_VERSION",
  "claims": [
    {
      "version": "NEW_VERSION",
      "claimed_by": "claude / <issuePrefix>-XXX brief description",
      "issue": "<issuePrefix>-XXX",
      "claimed_at": "ISO-8601 timestamp",
      "expires_at": "<claimed_at + 30 minutes>"
    }
  ]
}
```

Update the top-level `version` field to the new version as well.

**4. Create the worktree + branch** (idempotent — skip if it already exists for your version):

```bash
if ! git worktree list | grep -q "patch-VERSION"; then
  git worktree add .worktrees/patch-VERSION -b patch/VERSION
fi
```

If the branch/worktree exists but you did NOT create it this session, STOP — it is a live-collision
signal (another session may hold your version). Re-read `devops/version.lock` for concurrent
adjacent claims before proceeding; a missing `.worktree.lock` is not proof it is stale.

**5. Write a session lock file:**

```bash
cat > .worktrees/patch-VERSION/.worktree.lock <<LOCK
{
  "session_id": "$(date +%s)-$$",
  "claimed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "patch/VERSION",
  "task": "<issuePrefix>-XXX brief description"
}
LOCK
```

Before entering any existing worktree, check for a lock file. If `.worktree.lock` exists
and `claimed_at` is less than 2 hours old, **STOP** — another session may be active.

**All subsequent work happens inside the worktree directory.**

### Step 0.3: Determine What's Being Released

```bash
git log --oneline $TARGET_BRANCH..HEAD  # or main..dev for releases
git diff --stat $TARGET_BRANCH..HEAD
```

Check Plane for related in-progress or done items: `mcp__plane__workitem(action="list", project_id=<plane.projectId>, expand="state")`. Match the issue IDs cited in the commits above.

### Step 0.4: Present Release Plan

Ask the user to confirm before writing any files:

```
Release Plan
============
Project:         <name>
Current version: X.Y.Z
New version:     X.Y.Z (based on [release/patch] bump)

Commits since $TARGET_BRANCH:
- [commit list]

Proposed changelog bullets:
- **Label**: Description (<issuePrefix>-XX)

Proceed? [Adjust / Go]
```

Wait for user confirmation.

## Phase 1: Version Bump — PROJECT-SPECIFIC

**This phase is delegated to the project-level `release/SKILL.md`.**

If a project-level skill exists at `.claude/skills/release/SKILL.md`, read its Phase 1
section and follow those instructions for which files to edit and how.

If NO project-level override exists, apply these **sensible defaults**:

### Default: `package.json` (if it exists)

Update the `version` field:

```json
"version": "NEW_VERSION"
```

### Default: `CHANGELOG.md` (if it exists)

Insert a new section before the first versioned heading:

```markdown
## [NEW_VERSION] - YYYY-MM-DD

### Changed

- **Label**: Description (<issuePrefix>-XX)

---
```

### Default: `devops/version.lock`

Already updated in Phase 0.2 — the top-level `version` field was set.

### Default: `version.json` (if it exists)

```json
{
  "version": "NEW_VERSION",
  "releaseDate": "YYYY-MM-DD"
}
```

**Note:** Projects like StakTrakr and HexTrackr have extensive custom Phase 1 steps
(7+ files, seed data, announcements sync, etc.). Those are defined in their project-level
`release/SKILL.md` and override these defaults entirely.

## Phase 2: Verify

1. Run project-level verification if defined in the override skill
2. Otherwise, confirm version string appears in all modified files:
   ```bash
   grep -r "NEW_VERSION" --include="*.json" --include="*.js" --include="*.md" . | head -20
   ```
3. `git diff --stat` — confirm expected files changed
4. Run `npm run build` or equivalent if the project has a build step
5. Run tests if available: `npm test` or project-specific test command

Report any issues before proceeding.

## Phase 3: Commit

Stage and commit **on the patch branch** (inside the worktree):

```bash
git add <changed files>
git commit -m "vNEW_VERSION — TITLE"
```

Commit message format: `vNEW_VERSION — TITLE`
- Use em dash (`—`), not hyphen
- Include issue references: `v0.3.0 — FORGE-82: Portfolio link integration`

**Post-commit hooks** (project-specific — run if defined in project override):
- Wiki update (`/wiki-update`)
- DocVault update (`/vault-update`)
- Any project-specific post-commit steps

If the project override defines post-commit steps, follow them. Otherwise, proceed to Phase 4.

## Phase 4: Push & Draft PR

### Pre-flight (HARD GATE)

Verify no uncommitted changes remain:

```bash
git status --short
```

### Step 1: Push and create PR

```bash
git push origin patch/VERSION
```

Create the PR targeting the appropriate branch.

**Reviews (patch/release PRs):** apply the `codacy-review` label AND request a CodeRabbit
review with a `@coderabbitai review` PR comment. Small chore PRs (config/tooling, no runtime
code) skip both and rely on the Copilot/Codex auto-reviews alone.

CodeRabbit is **comment-triggered, not label-triggered** (2026-10-17). On the free OSS plan it
skips every PR it was not asked to review ("fewer than 10 stars" / "manual review required"),
the `coderabbit-review` label included, and its required `CodeRabbit` check still **passes**.
A green check is therefore not evidence of a review. Post the trigger once the PR is out of
draft (`gh pr ready` first if it opened as a draft), and post it again after any follow-up
push you want reviewed.

```bash
gh pr create --base $TARGET_BRANCH --head patch/VERSION --draft --label "codacy-review" \
  --title "vNEW_VERSION — [brief description]" \
  --body "$(cat <<'EOF'
> **Draft — QA preview.** Merge to `$TARGET_BRANCH` after review.

## Changes

- [bullet points]

## Issues (Plane)

- [<issuePrefix>-XX: title (status)]
EOF
)"
```

### Step 2: PR Resolution (MANDATORY)

1. Once the PR is out of draft, request the CodeRabbit review:
   `gh pr comment <number> --body "@coderabbitai review"`, then wait for CI/Codacy scans to start
2. Run `/pr-resolve` to monitor and resolve review threads
3. Confirm the PR is clean — all checks passing, no unresolved threads

The PR should be ready for merge with a single click.

## Phase 4.5: Ship `dev → main` (Only for projects with a `dev` branch)

**Only run when user explicitly says "release", "ready to ship", or "merge to main".**

Skip this phase entirely if the project PRs directly to `main` (no `dev` branch).

### Step 1: Audit

```bash
git fetch origin
git log --oneline main..origin/dev
git tag --merged origin/dev --sort=-version:refname | head -20
```

### Step 2: Fetch Plane issue titles

Read each referenced issue from Plane (`mcp__plane__workitem` (`action: "retrieve_by_identifier"`)) for accurate PR descriptions.

### Step 3: Create `dev → main` PR

```bash
gh pr create --base main --head dev --label "codacy-review" \
  --title "vLATEST_VERSION — [comprehensive title]" \
  --body "$(cat <<'EOF'
## Summary
- [user-readable descriptions grouped by version tag]

## Version Tags Included
- vX.Y.Z — [title]

## Issues (Plane)
- <issuePrefix>-XX: [title] ([status])
EOF
)"
```

### Step 4: Run project-specific pre-ship steps

If the project override defines Phase 4.5 steps (e.g., StakTrakr's announcements audit),
follow them here.

### Step 5: Mark ready and resolve

```bash
gh pr ready [number]
gh pr comment [number] --body "@coderabbitai review"
```

Run `/pr-resolve` to clear all threads.

### Step 6: Update Plane issues

Mark referenced issues **Done** in Plane (`mcp__plane__workitem` (`action: "update"`) with `workitem_id: <uuid>, state: <Done state id>`; resolve state ids via `mcp__plane__state` (`action: "list"`)).

### Step 7: After merge — run Phase 5 immediately

## Phase 5: GitHub Release & Tag (Post-Merge — MANDATORY)

**Only run after the PR has been merged.**

For projects with `dev` branch — tag targets `main` after `dev → main` merge:

```bash
git fetch origin main
gh release create vNEW_VERSION \
  --target main \
  --title "vNEW_VERSION — TITLE" \
  --latest \
  --notes "$(cat <<'EOF'
## TITLE

- [changelog bullets]
EOF
)"
```

For projects without `dev` branch — tag targets `main` after `patch → main` merge:

```bash
git fetch origin main
gh release create vNEW_VERSION \
  --target main \
  --title "vNEW_VERSION — TITLE" \
  --latest \
  --notes "$(cat <<'EOF'
## TITLE

- [changelog bullets]
EOF
)"
```

Verify:

```bash
gh release list --limit 3
```

## Phase 6: Cleanup & Confirm

```bash
# Remove worktree
rm -f .worktrees/patch-VERSION/.worktree.lock
git worktree remove .worktrees/patch-VERSION --force

# Delete branches
git branch -d patch/VERSION
git push origin --delete patch/VERSION

# Release version lock — remove only your claim, leave others intact
```

Report completion:

```
Release complete!

Project:  <name>
Version:  vNEW_VERSION
Commit:   [hash] [message]
PR:       #XX merged — [url]
Release:  https://github.com/lbruton/<repo>/releases/tag/vNEW_VERSION
Issues:   <issuePrefix>-XX → Done (Plane)
```

## Dry Run Mode

If the argument is `dry-run`:
- Complete Phase 0 (gather context, present plan)
- Show exactly what would change in each file
- Do NOT write any files, commit, push, or create PR
- End with: `Dry run complete — no files modified.`

## Project Override Contract

Project-level `release/SKILL.md` files can override any phase, but MUST define at minimum:

- **Phase 1** — which files to edit and how (the version bump recipe)
- Optionally: Phase 2 verification steps, Phase 3 post-commit hooks, Phase 4.5 pre-ship steps

The user-level skill handles everything else: lock protocol, worktree, PR, release, cleanup.
