/**
 * opencode CLI provider for oh-my-codex.
 *
 * Implements CliProvider for opencode (https://github.com/opencode-ai/opencode).
 * Ships with headless TUI mode — TUI-aware detection can be refined later
 * once opencode's terminal behaviour is fully characterised.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type {
  CliProvider,
  LaunchOpts,
  OmxConfig,
  TmuxKey,
  TuiContract,
} from './types.js';
import { assertProviderBinaryAvailable, injectGuidanceToFile } from './shared.js';

const MODEL_FLAG = '--model';

export class OpenCodeProvider implements CliProvider {
  readonly name = 'opencode';
  readonly binaryName = 'opencode';

  readonly tui: TuiContract = {
    mode: 'headless',
    submitKeyPresses: 1,
    supportsQueueMode: false,
    supportsAdaptiveRetry: false,
  };

  // -- 1. Config home / directory structure --------------------------------

  configHome(): string {
    return join(homedir(), '.opencode');
  }

  projectConfigDir(): string {
    return '.opencode';
  }

  guidanceFile(): string {
    // opencode reads AGENTS.md by convention (same as Codex).
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
    return join(projectRoot, '.opencode', 'skills');
  }

  projectAgentsDir(projectRoot: string): string {
    return join(projectRoot, '.opencode', 'agents');
  }

  configPath(): string {
    return join(this.configHome(), 'opencode.json');
  }

  // -- 2. Config file format -----------------------------------------------

  async writeConfig(config: OmxConfig): Promise<void> {
    const configPath = this.configPath();
    await mkdir(dirname(configPath), { recursive: true });

    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(configPath, 'utf-8');
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet; start fresh.
      } else {
        console.warn(`[omx] Warning: could not parse ${configPath}, resetting to defaults.`);
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

    // Merge model settings
    if (config.model) {
      existing.model = config.model;
    }

    await writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  }

  // -- 3. TUI interaction --------------------------------------------------

  detectTrustPrompt(_paneContent: string): boolean {
    // Headless — no trust prompt detection.
    return false;
  }

  dismissTrustPromptKeys(): TmuxKey[] {
    return [];
  }

  detectViewport(_paneContent: string): boolean {
    // Headless — no viewport detection.
    return false;
  }

  // -- 4. CLI argument translation -----------------------------------------

  buildLaunchArgs(opts: LaunchOpts): string[] {
    const args = [...opts.extraArgs];
    if (opts.model) {
      args.push(MODEL_FLAG, opts.model);
    }
    // opencode's approval bypass flag is not yet characterised.
    // For now, pass extra args through and rely on headless mode.
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
      'Install opencode: https://github.com/opencode-ai/opencode',
    );
  }
}
