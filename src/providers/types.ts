/**
 * CLI Provider abstraction layer for oh-my-codex.
 *
 * Every CLI backend (Codex, Claude, opencode, etc.) implements the
 * CliProvider interface.  OMX core routes all CLI-specific behaviour
 * through this interface so that adding a new backend never requires
 * touching orchestration code.
 */

// ---------------------------------------------------------------------------
// Provider-agnostic config types
// ---------------------------------------------------------------------------

/** A single MCP server definition in provider-agnostic form. */
export interface OmxMcpServer {
  /** Logical name used for the TOML table key / JSON key (e.g. "omx_state"). */
  name: string;
  /** Command to launch the server (e.g. "node"). */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Whether the server is enabled. */
  enabled: boolean;
  /** Optional timeout in milliseconds. */
  timeout?: number;
}

/**
 * Provider-agnostic configuration that OMX builds.
 * Each provider serialises this into its native format.
 */
export interface OmxConfig {
  /** MCP servers to register with the CLI. */
  mcpServers: OmxMcpServer[];
  /** Model reasoning effort level (e.g. "high"). */
  reasoningEffort?: string;
  /** Developer-level instructions injected into the CLI config. */
  developerInstructions?: string;
  /** Model identifier (e.g. "o3"). */
  model?: string;
  /** Model context window size. */
  modelContextWindow?: number;
  /** Auto-compact token limit. */
  modelAutoCompactTokenLimit?: number;
  /** Path to the notify hook script. */
  notifyHookPath?: string;
  /** Additional environment variables to set. */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Launch options
// ---------------------------------------------------------------------------

/** Options passed to a provider when building CLI launch arguments. */
export interface LaunchOpts {
  /** Whether to bypass approval / sandbox prompts. */
  bypassApprovals: boolean;
  /** Model to use (e.g. "o3", "claude-sonnet-4-20250514"). */
  model?: string;
  /** Initial prompt text to pass to the CLI. */
  initialPrompt?: string;
  /** Extra CLI arguments forwarded from the user. */
  extraArgs: string[];
  /** Current working directory for the session. */
  cwd?: string;
  /** Environment overrides. */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// TUI contract
// ---------------------------------------------------------------------------

/**
 * Describes how a CLI's terminal UI behaves during tmux-based orchestration.
 * Providers with `mode: 'headless'` skip viewport/prompt detection entirely.
 */
export interface TuiContract {
  /** Whether the CLI has a full TUI or is headless (pipe-friendly). */
  mode: 'full' | 'headless';
  /** Number of Enter key presses required to submit input in one round. */
  submitKeyPresses: number;
  /** Whether the CLI supports Tab-based queue-ahead input. */
  supportsQueueMode: boolean;
  /** Whether OMX should attempt adaptive retry for this CLI. */
  supportsAdaptiveRetry: boolean;
}

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

/** Declares what optional features a provider supports. */
export interface CliProviderCapabilities {
  /** TUI interaction mode. 'full' enables viewport/prompt detection. */
  tui: 'full' | 'headless';
  /** Whether the CLI supports queue-ahead (Tab+Enter) input. */
  queueMode: boolean;
  /** Whether OMX may use adaptive retry for submit confirmation. */
  adaptiveRetry: boolean;
  /** Whether viewport detection is available. */
  viewportDetection: boolean;
}

// ---------------------------------------------------------------------------
// CliProvider interface
// ---------------------------------------------------------------------------

/**
 * The single abstraction point between OMX core and any CLI tool.
 *
 * Covers all six coupling layers:
 *   1. Config home / directory structure
 *   2. Config file format (serialisation)
 *   3. TUI interaction contract
 *   4. CLI argument translation
 *   5. Prompt / guidance injection
 *   6. Binary resolution
 */
export interface CliProvider {
  /** Human-readable provider name (e.g. "codex", "claude", "opencode"). */
  readonly name: string;

  /** Binary name to look up in PATH (e.g. "codex", "claude", "opencode"). */
  readonly binaryName: string;

  /** Declared capabilities for this provider. */
  readonly capabilities: CliProviderCapabilities;

  /** TUI interaction contract for tmux-based orchestration. */
  readonly tui: TuiContract;

  // -- 1. Config home / directory structure --------------------------------

  /** Absolute path to the CLI's user-level config home (e.g. ~/.codex/). */
  configHome(): string;

  /** Relative directory name for project-level config (e.g. ".codex"). */
  projectConfigDir(): string;

  /** Filename the CLI reads for project-level guidance (e.g. "AGENTS.md"). */
  guidanceFile(): string;

  /** Absolute path to user-level skills directory. */
  skillsDir(): string;

  /** Absolute path to user-level prompts directory. */
  promptsDir(): string;

  /** Absolute path to user-level agents directory. */
  agentsDir(): string;

  /** Project-level skills directory for a given project root. */
  projectSkillsDir(projectRoot: string): string;

  /** Project-level agents directory for a given project root. */
  projectAgentsDir(projectRoot: string): string;

  /** Absolute path to the CLI's native config file. */
  configPath(): string;

  // -- 2. Config file format -----------------------------------------------

  /**
   * Write (or merge) an OmxConfig into the CLI's native config format.
   * Must preserve user-owned config sections outside OMX markers.
   */
  writeConfig(config: OmxConfig): Promise<void>;

  // -- 3. TUI interaction --------------------------------------------------

  /**
   * Detect whether tmux pane content contains a trust / permissions prompt.
   * Returns false for headless providers.
   */
  detectTrustPrompt(paneContent: string): boolean;

  /**
   * Return the tmux key sequence to dismiss a trust prompt.
   * E.g. ["2", "C-m"] for Claude's bypass-permissions accept.
   */
  dismissTrustPromptKeys(): string[];

  /**
   * Detect whether tmux pane content shows the CLI's viewport frame.
   * Returns false for headless providers.
   */
  detectViewport(paneContent: string): boolean;

  // -- 4. CLI argument translation -----------------------------------------

  /**
   * Build CLI-specific launch arguments from provider-agnostic options.
   * E.g. translate bypassApprovals into --dangerously-bypass-approvals-and-sandbox.
   */
  buildLaunchArgs(opts: LaunchOpts): string[];

  // -- 5. Prompt / guidance injection --------------------------------------

  /**
   * Inject runtime guidance into the project directory for this CLI.
   * Writes to the appropriate guidance file with OMX overlay markers.
   */
  injectGuidance(guidance: string, projectRoot: string): Promise<void>;

  // -- 6. Binary resolution ------------------------------------------------

  /**
   * Check whether the provider's CLI binary is available on PATH.
   * Throws with a descriptive message if not found.
   */
  assertBinaryAvailable(): void;
}
