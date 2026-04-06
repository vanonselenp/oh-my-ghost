# PRD: CLI Provider Abstraction Layer

## Introduction

OMX's orchestration (team coordination, workflow phases, completion loops, quality gates) is CLI-agnostic in concept but deeply coupled to Codex in implementation. Hardcoded paths (`~/.codex/`), Codex-specific TOML config generation, TUI interaction assumptions, and CLI-specific argument translation are scattered across ~15 files. This feature introduces a **CLI Provider interface** — a clean abstraction that lets anyone add a new CLI backend (codex, claude, opencode, or future tools) without touching OMX core. The existing codex-specific code is replaced entirely by the provider system.

## Goals

- Define a `CliProvider` interface that captures every point of CLI-specific behavior
- Extract all existing codex/claude/gemini coupling into provider implementations
- Ship built-in providers for codex, claude, and opencode
- Design the interface so it can become a plugin system later (separate packages, runtime discovery)
- Support both TUI-aware and headless interaction modes per provider
- Clean break — no backwards compatibility shims for the old codex-specific paths
- Any new CLI can be supported by implementing the interface alone, zero changes to OMX core

## User Stories

### US-001: Define the CliProvider interface
**Description:** As a contributor adding a new CLI backend, I need a single interface that tells me exactly what to implement so that OMX works with my CLI.

**Acceptance Criteria:**
- [ ] `CliProvider` interface defined in `src/providers/types.ts`
- [ ] Interface covers all 6 coupling layers: config home, config format, TUI contract, argument translation, prompt/guidance injection, binary resolution
- [ ] Each method/property is documented with its purpose and contract
- [ ] A `CliProviderCapabilities` type declares optional features (queue mode, adaptive retry, viewport detection)
- [ ] Typecheck passes

### US-002: Build the provider registry
**Description:** As the OMX runtime, I need to look up the correct provider by name so that all CLI-specific behavior is routed through the right implementation.

**Acceptance Criteria:**
- [ ] `ProviderRegistry` class in `src/providers/registry.ts`
- [ ] `register(name, provider)`, `get(name)`, `list()`, `has(name)` methods
- [ ] Built-in providers (codex, claude, opencode) auto-registered at startup
- [ ] `TeamWorkerCli` type replaced with `string` validated against registry
- [ ] Clear error message when requesting an unregistered provider
- [ ] Typecheck passes

### US-003: Extract CodexProvider from existing code
**Description:** As a developer, I need the existing Codex-specific behavior extracted into a provider implementation so the core is decoupled.

**Acceptance Criteria:**
- [ ] `CodexProvider` in `src/providers/codex.ts` implements `CliProvider`
- [ ] Config home returns `~/.codex/`
- [ ] Config writer generates native `config.toml` with `[mcp_servers.*]` sections
- [ ] Launch args include `--dangerously-bypass-approvals-and-sandbox` for bypass mode
- [ ] TUI contract: 2 key presses per submit, queue via Tab+Enter, adaptive retry supported
- [ ] Trust prompt detection: regex for "Do you trust the contents of this directory?"
- [ ] Viewport detection: `╭────────` box-drawing pattern
- [ ] Guidance injection writes to `AGENTS.md`
- [ ] Skills/prompts resolve from `~/.codex/skills/`, `~/.codex/prompts/`, `.codex/skills/`, `.codex/agents/`
- [ ] All existing Codex-specific tests still pass
- [ ] Typecheck passes

### US-004: Extract ClaudeProvider from existing code
**Description:** As a developer, I need the existing Claude-specific behavior extracted into a provider implementation.

**Acceptance Criteria:**
- [ ] `ClaudeProvider` in `src/providers/claude.ts` implements `CliProvider`
- [ ] Config home returns `~/.claude/`
- [ ] Config writer generates native `settings.json` with Claude Code's MCP schema
- [ ] Launch args include `--dangerously-skip-permissions` for bypass mode
- [ ] TUI contract: 1 key press per submit, no queue mode, no adaptive retry
- [ ] Trust prompt detection: regex for "Bypass Permissions mode"
- [ ] Guidance injection writes to `CLAUDE.md`
- [ ] Skills/prompts resolve from Claude Code's directory conventions
- [ ] Typecheck passes

### US-005: Create OpenCodeProvider
**Description:** As a developer, I need an opencode provider so OMX can use opencode as an execution engine.

**Acceptance Criteria:**
- [ ] `OpenCodeProvider` in `src/providers/opencode.ts` implements `CliProvider`
- [ ] Config home returns `~/.opencode/`
- [ ] Config writer generates native `opencode.json`
- [ ] Launch args handle opencode's CLI flags for model selection and approval bypass
- [ ] TUI contract defined (key presses, prompt patterns) or falls back to headless mode
- [ ] Guidance injection uses opencode's instruction mechanism
- [ ] Binary name resolves to `opencode` in PATH
- [ ] Typecheck passes

### US-006: Refactor paths.ts to delegate to providers
**Description:** As the OMX core, I need path resolution to go through the provider so I stop assuming `~/.codex/` everywhere.

**Acceptance Criteria:**
- [ ] `codexHome()`, `codexConfigPath()`, `codexPromptsDir()`, `codexAgentsDir()`, `projectCodexAgentsDir()`, `userSkillsDir()`, `projectSkillsDir()` replaced with provider-delegating equivalents
- [ ] Functions renamed to drop "codex" prefix (e.g., `cliConfigHome()`, `cliPromptsDir()`)
- [ ] All call sites updated to pass or resolve the active provider
- [ ] No remaining references to `~/.codex/` outside of `CodexProvider`
- [ ] Typecheck passes

### US-007: Refactor config generator to use provider's config writer
**Description:** As the OMX setup system, I need config generation to delegate to the provider so each CLI gets its native format.

**Acceptance Criteria:**
- [ ] `generator.ts` refactored: core logic builds a provider-agnostic `OmxConfig` object
- [ ] Each provider's `writeConfig(config)` method serializes to its native format (TOML, JSON, etc.)
- [ ] MCP server registration uses provider's `registerMcpServer()`
- [ ] `omx setup` detects or is told which provider to configure
- [ ] Codex TOML output is byte-identical to current output (no format regression)
- [ ] Claude JSON output matches Claude Code's `settings.json` schema
- [ ] Typecheck passes

### US-008: Refactor tmux-session.ts to use provider interface
**Description:** As the team runtime, I need all CLI-specific switch statements replaced with provider method calls.

**Acceptance Criteria:**
- [ ] `translateWorkerLaunchArgsForCli()` replaced with `provider.buildLaunchArgs()`
- [ ] `buildWorkerSubmitPlan()` reads `provider.tui.submitKeyPresses`, `provider.tui.supportsQueueMode`, `provider.tui.supportsAdaptiveRetry`
- [ ] `paneHasTrustPrompt()` / `paneHasClaudeBypassPermissionsPrompt()` replaced with `provider.detectTrustPrompt()`
- [ ] `dismissTrustPromptIfPresent()` replaced with `provider.dismissTrustPrompt()`
- [ ] `paneShowsCodexViewport()` replaced with `provider.detectViewport()`
- [ ] No remaining `if (workerCli === 'codex')` or `switch(workerCli)` in tmux-session.ts
- [ ] All existing team tests still pass
- [ ] Typecheck passes

### US-009: Refactor worker bootstrap to use provider's guidance injection
**Description:** As the worker initialization system, I need guidance injection to go through the provider so each CLI gets instructions in the format it understands.

**Acceptance Criteria:**
- [ ] `worker-bootstrap.ts` calls `provider.injectGuidance()` instead of writing directly to `AGENTS.md`
- [ ] Provider determines target file (AGENTS.md, CLAUDE.md, etc.) and marker format
- [ ] Skill loading uses `provider.skillsDir()` and `provider.promptsDir()`
- [ ] Worker overlay markers are provider-aware
- [ ] Typecheck passes

### US-010: Headless fallback mode for TUI interaction
**Description:** As a provider author, I need a way to declare that my CLI doesn't have a TUI (or has an unknown one) so OMX falls back to pipe-based interaction.

**Acceptance Criteria:**
- [ ] `CliProviderCapabilities` includes `tui: 'full' | 'headless'`
- [ ] When `tui: 'headless'`, OMX skips viewport detection, trust prompt handling, and adaptive retry
- [ ] Headless mode sends input directly without key-press counting
- [ ] Worker submit plan degrades gracefully (single key press, no queue, no retry)
- [ ] A provider can declare headless and still function for basic team orchestration
- [ ] Typecheck passes

### US-011: Refactor runtime-cli.ts to use provider registry
**Description:** As the CLI resolution layer, I need to validate and resolve providers through the registry instead of hardcoded names.

**Acceptance Criteria:**
- [ ] `normalizeAgentTypes()` validates against `registry.has(name)` instead of hardcoded list
- [ ] `resolveTeamWorkerCli()` uses registry for model→provider mapping
- [ ] `OMX_TEAM_WORKER_CLI` and `OMX_TEAM_WORKER_CLI_MAP` env vars accept any registered provider name
- [ ] Error messages list available providers from registry
- [ ] Typecheck passes

### US-012: Update omx setup for multi-provider support
**Description:** As a user, I need `omx setup` to configure whichever CLI provider I'm using, not just Codex.

**Acceptance Criteria:**
- [ ] `omx setup` accepts `--provider <name>` flag (defaults to auto-detect from installed binaries)
- [ ] Setup installs skills/prompts/MCP config into the correct provider directories
- [ ] `omx doctor` validates the active provider's configuration
- [ ] Setup can configure multiple providers in one run (`--provider codex --provider claude`)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The `CliProvider` interface must be the **sole** abstraction point between OMX core and any CLI tool — no CLI-specific logic outside of provider implementations
- FR-2: Each provider must write native config in the CLI's own format and directory structure
- FR-3: Each provider must declare its TUI capabilities; providers without TUI support fall back to headless mode
- FR-4: The provider registry must be initialized before any team, ralph, or setup operation
- FR-5: `omx setup --provider <name>` must install OMX artifacts (skills, prompts, MCP servers) into the provider's native locations
- FR-6: Worker spawning must resolve the provider from the registry and use only provider methods for launch, interaction, and detection
- FR-7: Mixed-provider teams must be supported (e.g., worker 1 uses codex, worker 2 uses claude, worker 3 uses opencode) via `OMX_TEAM_WORKER_CLI_MAP`
- FR-8: The provider interface must be stable enough that external packages could implement it without OMX source changes (plugin-ready design)
- FR-9: `omx doctor` must validate the active provider's binary availability, config integrity, and MCP server registration

## Non-Goals

- No plugin discovery/loading system in this phase (providers are built-in, but the interface is plugin-ready)
- No runtime hot-swapping of providers mid-session
- No backwards compatibility with old `~/.codex/`-only setup (clean break)
- No provider-specific skill or prompt content — the same skills/prompts work across all providers
- No GUI or web-based provider configuration
- No automatic migration tool from old codex-only setup to new provider-based setup

## Technical Considerations

- **Largest refactors:** `src/config/generator.ts` (~700 lines) and `src/team/tmux-session.ts` (~1300 lines) contain the most scattered CLI assumptions. These should be tackled methodically — extract, test, replace.
- **opencode TUI:** opencode's terminal behavior will need to be characterized (key presses, prompts, viewport). If unknown at implementation time, ship with `tui: 'headless'` and refine later.
- **Config format divergence:** Codex uses TOML, Claude uses JSON, opencode uses JSON. The provider-agnostic `OmxConfig` intermediate representation is key — providers serialize from this.
- **MCP server registration:** Each CLI has different MCP schemas. The provider must translate OMX's MCP server definitions to the native format.
- **Testing:** Each provider should have unit tests that verify config output matches the CLI's expected format. Integration tests should verify worker launch with each provider (may require mocking tmux).
- **Import boundaries:** Provider implementations should not import from each other. Core should not import from any specific provider — only from `types.ts` and `registry.ts`.

## Success Metrics

- Zero CLI-specific `if`/`switch` statements outside of `src/providers/` implementations
- All three providers (codex, claude, opencode) pass team orchestration smoke tests
- Adding a hypothetical fourth provider requires only a new file in `src/providers/` and a `register()` call
- `omx setup --provider claude` produces valid Claude Code configuration
- Mixed-provider teams (`OMX_TEAM_WORKER_CLI_MAP=codex,opencode,claude`) launch and coordinate successfully

## Open Questions

- What is opencode's exact CLI flag for bypassing approval prompts? Needs characterization.
- What is opencode's TUI submit behavior (key presses, viewport pattern)? May need to ship headless initially.
- Should `omx setup` auto-detect installed CLIs and configure all of them, or require explicit `--provider` selection?
- Should the provider interface include a `capabilities.maxConcurrentWorkers` property, or is that always an OMX-level concern?
- How should MCP server timeout semantics differ across providers (Codex supports `timeout` in TOML, Claude may not)?
