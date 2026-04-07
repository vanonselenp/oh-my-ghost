/**
 * Codex CLI provider for oh-my-codex.
 *
 * Extracts all Codex-specific behaviour (paths, config format, TUI contract,
 * argument translation, guidance injection, binary resolution) into a single
 * CliProvider implementation.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type {
  CliProvider,
  CliProviderCapabilities,
  LaunchOpts,
  OmxConfig,
  TmuxKey,
  TuiContract,
} from './types.js';
import { assertProviderBinaryAvailable, injectGuidanceToFile } from './shared.js';

const CODEX_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';
const MODEL_FLAG = '--model';
const CONFIG_FLAG = '-c';

const OMX_MARKER_START = '# --- oh-my-codex (OMX) managed start ---';
const OMX_MARKER_END = '# --- oh-my-codex (OMX) managed end ---';
const SHARED_MCP_REGISTRY_MARKER = '# oh-my-codex (OMX) Shared MCP Registry Sync';
const SHARED_MCP_REGISTRY_END_MARKER = '# End oh-my-codex shared MCP registry sync';

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export class CodexProvider implements CliProvider {
  readonly name = 'codex';
  readonly binaryName = 'codex';

  readonly capabilities: CliProviderCapabilities = {
    tui: 'full',
    queueMode: true,
    adaptiveRetry: true,
    viewportDetection: true,
  };

  readonly tui: TuiContract = {
    mode: 'full',
    submitKeyPresses: 2,
    supportsQueueMode: true,
    supportsAdaptiveRetry: true,
  };

  // -- 1. Config home / directory structure --------------------------------

  configHome(): string {
    return process.env.CODEX_HOME || join(homedir(), '.codex');
  }

  projectConfigDir(): string {
    return '.codex';
  }

  guidanceFile(): string {
    return 'AGENTS.md';
  }

  skillsDir(): string {
    return join(this.configHome(), 'skills');
  }

  promptsDir(): string {
    return join(this.configHome(), 'prompts');
  }

  agentsDir(): string {
    return join(this.configHome(), 'agents');
  }

  projectSkillsDir(projectRoot: string): string {
    return join(projectRoot, '.codex', 'skills');
  }

  projectAgentsDir(projectRoot: string): string {
    return join(projectRoot, '.codex', 'agents');
  }

  configPath(): string {
    return join(this.configHome(), 'config.toml');
  }

  // -- 2. Config file format -----------------------------------------------

  async writeConfig(config: OmxConfig): Promise<void> {
    const configPath = this.configPath();
    await mkdir(dirname(configPath), { recursive: true });

    let existing = '';
    try {
      existing = await readFile(configPath, 'utf-8');
    } catch {
      // File doesn't exist yet; start empty.
    }

    const merged = mergeTomlConfig(existing, config);
    await writeFile(configPath, merged, 'utf-8');
  }

  // -- 3. TUI interaction --------------------------------------------------

  detectTrustPrompt(paneContent: string): boolean {
    const lines = paneContent
      .split('\n')
      .map((line) => line.replace(/\r/g, '').trim())
      .filter((line) => line.length > 0);
    const tail = lines.slice(-12);
    const hasQuestion = tail.some((line) =>
      /Do you trust the contents of this directory\?/i.test(line),
    );
    const hasActiveChoices = tail.some((line) =>
      /Yes,\s*continue|No,\s*quit|Press enter to continue/i.test(line),
    );
    return hasQuestion && hasActiveChoices;
  }

  dismissTrustPromptKeys(): TmuxKey[] {
    // Codex trust prompt: press Enter twice (trust + follow-up splash).
    return [{ type: 'key', name: 'C-m' }, { type: 'key', name: 'C-m' }];
  }

  detectViewport(paneContent: string): boolean {
    const lines = paneContent
      .split('\n')
      .map((line) => line.replace(/\r/g, '').trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return false;

    const hasCodexBanner = lines.some((line) =>
      /\bOpenAI Codex\b/i.test(line),
    );
    if (!hasCodexBanner) return false;

    return lines.some((line) => /(?:^|\s)(?:model|directory):/i.test(line));
  }

  // -- 4. CLI argument translation -----------------------------------------

  buildLaunchArgs(opts: LaunchOpts): string[] {
    const args = [...opts.extraArgs];

    if (opts.bypassApprovals && !args.includes(CODEX_BYPASS_FLAG)) {
      args.push(CODEX_BYPASS_FLAG);
    }
    if (opts.model) {
      args.push(MODEL_FLAG, opts.model);
    }

    return args;
  }

  // -- 5. Prompt / guidance injection --------------------------------------

  async injectGuidance(guidance: string, projectRoot: string): Promise<void> {
    await injectGuidanceToFile(join(projectRoot, this.guidanceFile()), guidance);
  }

  // -- 6. Binary resolution ------------------------------------------------

  assertBinaryAvailable(): void {
    assertProviderBinaryAvailable(
      this.binaryName,
      'Install Codex CLI: npm install -g @openai/codex',
    );
  }
}

// ---------------------------------------------------------------------------
// TOML config merge helpers
// ---------------------------------------------------------------------------

function stripOmxManagedBlock(content: string): string {
  const startIdx = content.indexOf(OMX_MARKER_START);
  const endIdx = content.indexOf(OMX_MARKER_END);
  if (startIdx === -1 || endIdx === -1) return content;
  return (
    content.slice(0, startIdx) +
    content.slice(endIdx + OMX_MARKER_END.length)
  ).replace(/\n{3,}/g, '\n\n');
}

function stripSharedMcpBlock(content: string): string {
  const startIdx = content.indexOf(SHARED_MCP_REGISTRY_MARKER);
  const endIdx = content.indexOf(SHARED_MCP_REGISTRY_END_MARKER);
  if (startIdx === -1 || endIdx === -1) return content;
  return (
    content.slice(0, startIdx) +
    content.slice(endIdx + SHARED_MCP_REGISTRY_END_MARKER.length)
  ).replace(/\n{3,}/g, '\n\n');
}

function mergeTomlConfig(existing: string, config: OmxConfig): string {
  // Strip previous OMX-managed blocks
  let base = stripOmxManagedBlock(existing);
  base = stripSharedMcpBlock(base);

  const omxLines: string[] = [];
  omxLines.push(OMX_MARKER_START);

  // Top-level keys (must appear before any [table])
  if (config.notifyHookPath) {
    omxLines.push(`notify = ["node", "${escapeTomlString(config.notifyHookPath)}"]`);
  }
  if (config.reasoningEffort) {
    omxLines.push(`model_reasoning_effort = "${escapeTomlString(config.reasoningEffort)}"`);
  }
  if (config.developerInstructions) {
    omxLines.push(
      `developer_instructions = "${escapeTomlString(config.developerInstructions)}"`,
    );
  }
  if (config.model) {
    omxLines.push(`model = "${escapeTomlString(config.model)}"`);
  }
  if (config.modelContextWindow) {
    omxLines.push(`model_context_window = ${config.modelContextWindow}`);
  }
  if (config.modelAutoCompactTokenLimit) {
    omxLines.push(
      `model_auto_compact_token_limit = ${config.modelAutoCompactTokenLimit}`,
    );
  }

  omxLines.push(OMX_MARKER_END);

  // MCP servers as separate block
  const mcpLines: string[] = [];
  if (config.mcpServers.length > 0) {
    mcpLines.push('');
    mcpLines.push(SHARED_MCP_REGISTRY_MARKER);
    for (const server of config.mcpServers) {
      mcpLines.push('');
      mcpLines.push(`[mcp_servers.${server.name}]`);
      mcpLines.push(`command = "${escapeTomlString(server.command)}"`);
      const argsStr = server.args
        .map((a) => `"${escapeTomlString(a)}"`)
        .join(', ');
      mcpLines.push(`args = [${argsStr}]`);
      mcpLines.push(`enabled = ${server.enabled}`);
      if (server.timeout !== undefined) {
        mcpLines.push(`timeout = ${server.timeout}`);
      }
    }
    mcpLines.push('');
    mcpLines.push(SHARED_MCP_REGISTRY_END_MARKER);
  }

  // Environment variables
  const envLines: string[] = [];
  if (config.env && Object.keys(config.env).length > 0) {
    envLines.push('');
    envLines.push('[env]');
    for (const [key, value] of Object.entries(config.env)) {
      envLines.push(`${key} = "${escapeTomlString(value)}"`);
    }
  }

  const result = [
    base.trimEnd(),
    '',
    omxLines.join('\n'),
    mcpLines.join('\n'),
    envLines.join('\n'),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';

  return result;
}
