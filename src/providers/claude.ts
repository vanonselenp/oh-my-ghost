/**
 * Claude Code CLI provider for oh-my-codex.
 *
 * Implements CliProvider for Claude Code (the `claude` binary).
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

const CLAUDE_SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';

export class ClaudeProvider implements CliProvider {
  readonly name = 'claude';
  readonly binaryName = 'claude';

  readonly capabilities: CliProviderCapabilities = {
    tui: 'full',
    queueMode: false,
    adaptiveRetry: false,
    viewportDetection: false,
  };

  readonly tui: TuiContract = {
    mode: 'full',
    submitKeyPresses: 1,
    supportsQueueMode: false,
    supportsAdaptiveRetry: false,
  };

  // -- 1. Config home / directory structure --------------------------------

  configHome(): string {
    return join(homedir(), '.claude');
  }

  projectConfigDir(): string {
    return '.claude';
  }

  guidanceFile(): string {
    return 'CLAUDE.md';
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
    return join(projectRoot, '.claude', 'skills');
  }

  projectAgentsDir(projectRoot: string): string {
    return join(projectRoot, '.claude', 'agents');
  }

  configPath(): string {
    return join(this.configHome(), 'settings.json');
  }

  // -- 2. Config file format -----------------------------------------------

  async writeConfig(config: OmxConfig): Promise<void> {
    const configPath = this.configPath();
    await mkdir(dirname(configPath), { recursive: true });

    let existing: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8');
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // If the file is malformed, start fresh.
      }
    }

    // Merge MCP servers
    const mcpServers: Record<string, unknown> =
      (existing.mcpServers as Record<string, unknown>) ?? {};
    for (const server of config.mcpServers) {
      mcpServers[server.name] = {
        command: server.command,
        args: server.args,
        ...(server.timeout !== undefined ? { timeout: server.timeout } : {}),
      };
    }
    if (config.mcpServers.length > 0) {
      existing.mcpServers = mcpServers;
    }

    // Merge other settings
    if (config.model) {
      existing.model = config.model;
    }
    if (config.reasoningEffort) {
      existing.reasoningEffort = config.reasoningEffort;
    }

    await writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  }

  // -- 3. TUI interaction --------------------------------------------------

  detectTrustPrompt(paneContent: string): boolean {
    const lines = paneContent
      .split('\n')
      .map((line) => line.replace(/\r/g, '').trim())
      .filter((line) => line.length > 0);
    const tail = lines.slice(-20);
    const hasWarning = tail.some((line) =>
      /Bypass Permissions mode/i.test(line),
    );
    const hasChoices =
      tail.some((line) => /No,\s*exit/i.test(line)) &&
      tail.some((line) => /Yes,\s*I\s*accept/i.test(line)) &&
      tail.some((line) => /Enter\s*to\s*confirm/i.test(line));
    return hasWarning && hasChoices;
  }

  dismissTrustPromptKeys(): TmuxKey[] {
    // Claude bypass prompt: press "2" then Enter to accept.
    return [{ type: 'literal', char: '2' }, { type: 'key', name: 'C-m' }];
  }

  detectViewport(_paneContent: string): boolean {
    // Claude Code does not have a viewport frame to detect.
    return false;
  }

  // -- 4. CLI argument translation -----------------------------------------

  buildLaunchArgs(opts: LaunchOpts): string[] {
    // Claude workers launch with only the permissions bypass flag.
    // All other Codex-specific flags are dropped.
    const args: string[] = [];
    if (opts.bypassApprovals) {
      args.push(CLAUDE_SKIP_PERMISSIONS_FLAG);
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
      'Install Claude Code: npm install -g @anthropic-ai/claude-code',
    );
  }
}
