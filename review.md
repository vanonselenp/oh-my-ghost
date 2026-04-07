# Code Review: `execution-agnostic` branch

**Overview:** Major architectural change introducing a CLI provider abstraction layer to make OMX execution-engine agnostic. Adds support for Claude Code, OpenCode, and Gemini CLI alongside Codex as first-class execution engines (~3,400 lines across 23 files).

---

## Open Items

**1. Mixed-Provider Team Semantics Are Unclear** (`src/team/runtime.ts:1387`)
- In single-workspace (non-worktree) mode, one shared instructions file is written using the "dominant" provider — which is `undefined` for mixed teams
- Per-worker fallback now correctly uses `workerProvider?.guidanceFile()` (fixed), but the shared overlay base file still uses the dominant provider's guidance filename
- Low risk in practice: the shared file is the overlay base; per-worker files resolve the correct guidance filename independently

**2. No Integration Tests for Multi-Provider Teams** *(known gap, larger effort)*
- Unit tests cover each provider in isolation (good), but:
  - No tests for team startup with `OMX_TEAM_WORKER_CLI=claude`
  - No tests for mixed-provider teams (`OMX_TEAM_WORKER_CLI_MAP=codex,claude`)
  - No tests for `omx setup --provider <x>` config output

**3. No Config Round-Trip Tests**
- Claude JSON and Codex TOML writers have no round-trip/identity tests
- TOML edge cases (newlines, quotes, control chars) in config values untested

---

## Minor Issues

- **`cliConfigHome(provider)` naming is verbose** compared to `provider.configHome()` — the provider method pattern is cleaner
- **Fallback scanning in `detectTrustPromptViaProviders()`** logs to stderr on mismatch but doesn't throw — could silently mis-route TUI detection
- **Global registry singleton** (`src/providers/registry.ts`) — registered at module import time; makes provider-set isolation in tests harder; consider DI as a future improvement

---

## Fixed

- **Hardcoded `AGENTS.md` fallback** (`runtime.ts`) — per-worker fallback now uses `workerProvider?.guidanceFile() ?? 'AGENTS.md'`
- **Incomplete TOML escaping** (`codex.ts`) — `escapeTomlString` now handles `\t` and all remaining control chars
- **Deprecated `codexHome()` call** (`worker-bootstrap.ts`) — replaced with inlined Codex path logic; `codexHome` import removed

---

## Not Pursued (Intentional Design)

- **Stale lock `existing !== null` check** — intentional TOCTOU guard: unparseable lock is treated as busy rather than cleared, per adjacent comment
- **`TeamWorkerCli = string`** — deliberate to support arbitrary custom providers; documented in the type comment
- **Path traversal in `injectGuidanceToFile`** — low severity; `projectRoot` is user-controlled, not externally sourced

---

## What's Done Well

- Provider class structure is clean with consistent sections (config, TUI, args, guidance, binary)
- `realpathSync()` fixes on tmpdir are correct and applied consistently
- 522-line unit test file covers all providers with idempotency and malformed-input cases
- README updated to reflect multi-provider support clearly

---

## Recommendations

| Priority | Action |
|---|---|
| **Medium** | Add integration tests for multi-provider team launch (larger effort) |
| **Low** | Config round-trip tests for Claude JSON and Codex TOML |
