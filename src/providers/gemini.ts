/**
 * Google Gemini CLI provider for oh-my-codex.
 *
 * Implements CliProvider for the `gemini` binary.
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

const GEMINI_APPROVAL_MODE_FLAG = '--approval-mode';
const GEMINI_APPROVAL_MODE_YOLO = 'yolo';
const GEMINI_PROMPT_INTERACTIVE_FLAG = '-i';
const MODEL_FLAG = '--model';

export class GeminiProvider implements CliProvider {
  readonly name = 'gemini';
  readonly binaryName = 'gemini';

  readonly capabilities: CliProviderCapabilities = {
    tui: 'headless',
    queueMode: false,
    adaptiveRetry: false,
    viewportDetection: false,
  };

  readonly tui: TuiContract = {
    mode: 'headless',
    submitKeyPresses: 1,
    supportsQueueMode: false,
    supportsAdaptiveRetry: false,
  };

  // -- 1. Config home / directory structure --------------------------------

  configHome(): string {
    return join(homedir(), '.gemini');
  }

  projectConfigDir(): string {
    return '.gemini';
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
    return join(projectRoot, '.gemini', 'skills');
  }

  projectAgentsDir(projectRoot: string): string {
    return join(projectRoot, '.gemini', 'agents');
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

    if (config.model) {
      existing.model = config.model;
    }

    if (config.mcpServers && config.mcpServers.length > 0) {
      // Gemini CLI does not support MCP server configuration via settings.json.
      // MCP servers must be configured separately; they are ignored here.
      console.warn(
        '[omx:gemini] writeConfig: mcpServers are not supported by the Gemini CLI config format and were not written.',
      );
    }

    await writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  }

  // -- 3. TUI interaction --------------------------------------------------

  detectTrustPrompt(_paneContent: string): boolean {
    // Gemini CLI uses --approval-mode yolo; no interactive trust prompt.
    return false;
  }

  dismissTrustPromptKeys(): TmuxKey[] {
    return [];
  }

  detectViewport(_paneContent: string): boolean {
    return false;
  }

  // -- 4. CLI argument translation -----------------------------------------

  buildLaunchArgs(opts: LaunchOpts): string[] {
    const args: string[] = [GEMINI_APPROVAL_MODE_FLAG, GEMINI_APPROVAL_MODE_YOLO];

    if (opts.initialPrompt) {
      args.push(GEMINI_PROMPT_INTERACTIVE_FLAG, opts.initialPrompt);
    }

    // Only pass through model flags that look like Gemini models.
    if (opts.model && /gemini/i.test(opts.model)) {
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
      'Install Gemini CLI: npm install -g @google/gemini-cli',
    );
  }
}
