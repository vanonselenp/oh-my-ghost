/**
 * Unit tests for CliProvider implementations and ProviderRegistry.
 *
 * Each provider's writeConfig() and buildLaunchArgs() are tested in isolation
 * against a temporary directory so no real user config is touched.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { realpathSync } from 'fs';

import { CodexProvider } from '../codex.js';
import { ClaudeProvider } from '../claude.js';
import { GeminiProvider } from '../gemini.js';
import { OpenCodeProvider } from '../opencode.js';
import { ProviderRegistry } from '../registry.js';
import type { OmxConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal OmxConfig with no optional fields. */
function baseConfig(overrides: Partial<OmxConfig> = {}): OmxConfig {
  return {
    mcpServers: [],
    ...overrides,
  };
}

function mcpServer(name: string) {
  return {
    name,
    command: 'node',
    args: ['/path/to/server.js'],
    enabled: true,
    timeout: 5000,
  };
}

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

describe('ClaudeProvider', () => {
  let tmpDir: string;
  let configPath: string;
  let provider: ClaudeProvider;

  beforeEach(async () => {
    tmpDir = realpathSync(await mkdtemp(join(tmpdir(), 'omx-claude-test-')));
    configPath = join(tmpDir, 'settings.json');
    // Subclass to redirect configPath without touching homedir
    class TestClaudeProvider extends ClaudeProvider {
      override configPath() { return configPath; }
    }
    provider = new TestClaudeProvider();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('writeConfig()', () => {
    it('creates settings.json with MCP servers and model', async () => {
      await provider.writeConfig(baseConfig({
        mcpServers: [mcpServer('omx_state')],
        model: 'claude-opus-4-6',
      }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.deepEqual(written.mcpServers.omx_state, {
        command: 'node',
        args: ['/path/to/server.js'],
        timeout: 5000,
      });
      assert.equal(written.model, 'claude-opus-4-6');
    });

    it('merges with existing user config and preserves unknown keys', async () => {
      await mkdir(join(tmpDir), { recursive: true });
      await writeFile(configPath, JSON.stringify({ theme: 'dark', mcpServers: { existing: { command: 'foo', args: [] } } }), 'utf-8');
      await provider.writeConfig(baseConfig({
        mcpServers: [mcpServer('omx_state')],
      }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.equal(written.theme, 'dark', 'user key preserved');
      assert.ok(written.mcpServers.existing, 'existing MCP server preserved');
      assert.ok(written.mcpServers.omx_state, 'new MCP server added');
    });

    it('is idempotent — running twice produces the same result', async () => {
      const config = baseConfig({
        mcpServers: [mcpServer('omx_state')],
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
      });
      await provider.writeConfig(config);
      const first = await readFile(configPath, 'utf-8');
      await provider.writeConfig(config);
      const second = await readFile(configPath, 'utf-8');
      assert.equal(first, second);
    });

    it('recovers from malformed JSON by starting fresh', async () => {
      await mkdir(join(tmpDir), { recursive: true });
      await writeFile(configPath, '{ broken json', 'utf-8');
      await provider.writeConfig(baseConfig({ model: 'claude-haiku-4-5' }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.equal(written.model, 'claude-haiku-4-5');
    });
  });

  describe('buildLaunchArgs()', () => {
    it('emits --dangerously-skip-permissions when bypassApprovals is true', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [] });
      assert.deepEqual(result, ['--dangerously-skip-permissions']);
    });

    it('emits no args when bypassApprovals is false', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: false, extraArgs: [] });
      assert.deepEqual(result, []);
    });
  });

  describe('detectTrustPrompt()', () => {
    it('detects the Claude bypass permissions prompt', () => {
      const content = [
        'Some header',
        'Bypass Permissions mode — this can be dangerous',
        'Yes, I accept the risks',
        'No, exit',
        'Press Enter to confirm',
      ].join('\n');
      assert.equal(provider.detectTrustPrompt(content), true);
    });

    it('returns false for normal pane content', () => {
      assert.equal(provider.detectTrustPrompt('Working on task...\n> '), false);
    });
  });

  it('has correct static metadata', () => {
    assert.equal(provider.name, 'claude');
    assert.equal(provider.binaryName, 'claude');
    assert.equal(provider.guidanceFile(), 'CLAUDE.md');
    assert.equal(provider.tui.mode, 'full');
    assert.equal(provider.tui.supportsQueueMode, false);
  });
});

// ---------------------------------------------------------------------------
// CodexProvider
// ---------------------------------------------------------------------------

describe('CodexProvider', () => {
  let tmpDir: string;
  let configPath: string;
  let provider: CodexProvider;

  beforeEach(async () => {
    tmpDir = realpathSync(await mkdtemp(join(tmpdir(), 'omx-codex-test-')));
    configPath = join(tmpDir, 'config.toml');
    class TestCodexProvider extends CodexProvider {
      override configPath() { return configPath; }
    }
    provider = new TestCodexProvider();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const OMX_MARKER_START = '# --- oh-my-codex (OMX) managed start ---';
  const OMX_MARKER_END = '# --- oh-my-codex (OMX) managed end ---';
  const MCP_MARKER = '# oh-my-codex (OMX) Shared MCP Registry Sync';

  describe('writeConfig()', () => {
    it('writes config.toml with OMX managed block', async () => {
      await provider.writeConfig(baseConfig({
        model: 'o3',
        reasoningEffort: 'high',
        notifyHookPath: '/usr/local/lib/notify.js',
      }));
      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes(OMX_MARKER_START));
      assert.ok(content.includes(OMX_MARKER_END));
      assert.ok(content.includes('model = "o3"'));
      assert.ok(content.includes('model_reasoning_effort = "high"'));
      assert.ok(content.includes('notify = ["node", "/usr/local/lib/notify.js"]'));
    });

    it('writes MCP servers in separate block', async () => {
      await provider.writeConfig(baseConfig({
        mcpServers: [mcpServer('omx_state')],
      }));
      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes(MCP_MARKER));
      assert.ok(content.includes('[mcp_servers.omx_state]'));
      assert.ok(content.includes('command = "node"'));
      assert.ok(content.includes('enabled = true'));
    });

    it('preserves user config outside markers', async () => {
      await mkdir(tmpDir, { recursive: true });
      const userConfig = 'theme = "dark"\nsome_setting = true\n';
      await writeFile(configPath, userConfig, 'utf-8');
      await provider.writeConfig(baseConfig({ model: 'o3' }));
      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes('theme = "dark"'));
      assert.ok(content.includes('some_setting = true'));
      assert.ok(content.includes('model = "o3"'));
    });

    it('is idempotent — replaces previous OMX markers on second run', async () => {
      const config = baseConfig({
        model: 'o3',
        mcpServers: [mcpServer('omx_state')],
      });
      await provider.writeConfig(config);
      const first = await readFile(configPath, 'utf-8');
      await provider.writeConfig(config);
      const second = await readFile(configPath, 'utf-8');
      assert.equal(first, second, 'second write should produce identical output');
      // Only one copy of each marker
      const markerCount = (second.match(new RegExp(OMX_MARKER_START.replace(/[()[\]{}*+?.,\\^$|#\s]/g, '\\$&'), 'g')) ?? []).length;
      assert.equal(markerCount, 1, 'OMX start marker must appear exactly once');
    });

    it('escapes special characters in model name', async () => {
      await provider.writeConfig(baseConfig({ model: 'o3\\special"model' }));
      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes('o3\\\\special\\"model'), 'backslash and quote escaped');
    });

    it('escapes newlines in developer instructions', async () => {
      await provider.writeConfig(baseConfig({ developerInstructions: 'line1\nline2' }));
      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes('line1\\nline2'), 'newline escaped as \\n');
      assert.ok(!content.includes('line1\nline2'), 'literal newline not present in TOML string');
    });
  });

  describe('buildLaunchArgs()', () => {
    it('appends bypass flag when bypassApprovals is true', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [] });
      assert.ok(result.includes('--dangerously-bypass-approvals-and-sandbox'));
    });

    it('does not duplicate bypass flag if already present in extraArgs', () => {
      const result = provider.buildLaunchArgs({
        bypassApprovals: true,
        extraArgs: ['--dangerously-bypass-approvals-and-sandbox'],
      });
      const count = result.filter((a) => a === '--dangerously-bypass-approvals-and-sandbox').length;
      assert.equal(count, 1);
    });

    it('passes extraArgs through unchanged', () => {
      const result = provider.buildLaunchArgs({
        bypassApprovals: false,
        extraArgs: ['--model', 'o3', '-c', 'reasoning="high"'],
      });
      assert.deepEqual(result, ['--model', 'o3', '-c', 'reasoning="high"']);
    });

    it('appends --model flag when model is provided', () => {
      const result = provider.buildLaunchArgs({
        bypassApprovals: false,
        model: 'o3',
        extraArgs: [],
      });
      assert.ok(result.includes('--model'));
      assert.ok(result.includes('o3'));
    });
  });

  describe('detectTrustPrompt()', () => {
    it('detects Codex trust prompt', () => {
      const content = [
        'OpenAI Codex',
        'Do you trust the contents of this directory?',
        'Yes, continue',
        'No, quit',
      ].join('\n');
      assert.equal(provider.detectTrustPrompt(content), true);
    });

    it('returns false for normal pane content', () => {
      assert.equal(provider.detectTrustPrompt('Running task...\n$ '), false);
    });

    it('returns false when only question present but no choices', () => {
      assert.equal(
        provider.detectTrustPrompt('Do you trust the contents of this directory?'),
        false,
      );
    });
  });

  it('has correct static metadata', () => {
    assert.equal(provider.name, 'codex');
    assert.equal(provider.binaryName, 'codex');
    assert.equal(provider.guidanceFile(), 'AGENTS.md');
    assert.equal(provider.tui.mode, 'full');
    assert.equal(provider.tui.supportsQueueMode, true);
  });
});

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

describe('GeminiProvider', () => {
  let tmpDir: string;
  let configPath: string;
  let provider: GeminiProvider;

  beforeEach(async () => {
    tmpDir = realpathSync(await mkdtemp(join(tmpdir(), 'omx-gemini-test-')));
    configPath = join(tmpDir, 'settings.json');
    class TestGeminiProvider extends GeminiProvider {
      override configPath() { return configPath; }
    }
    provider = new TestGeminiProvider();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('writeConfig()', () => {
    it('writes model to settings.json', async () => {
      await provider.writeConfig(baseConfig({ model: 'gemini-2.0-pro' }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.equal(written.model, 'gemini-2.0-pro');
    });

    it('preserves existing user keys', async () => {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(configPath, JSON.stringify({ theme: 'light' }), 'utf-8');
      await provider.writeConfig(baseConfig({ model: 'gemini-2.0-pro' }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.equal(written.theme, 'light');
      assert.equal(written.model, 'gemini-2.0-pro');
    });

    it('is idempotent', async () => {
      const config = baseConfig({ model: 'gemini-2.0-pro' });
      await provider.writeConfig(config);
      const first = await readFile(configPath, 'utf-8');
      await provider.writeConfig(config);
      const second = await readFile(configPath, 'utf-8');
      assert.equal(first, second);
    });
  });

  describe('buildLaunchArgs()', () => {
    it('always includes --approval-mode yolo', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [] });
      assert.ok(result.includes('--approval-mode'));
      assert.ok(result.includes('yolo'));
    });

    it('includes -i with prompt when initialPrompt is provided', () => {
      const result = provider.buildLaunchArgs({
        bypassApprovals: true,
        extraArgs: [],
        initialPrompt: 'Read your inbox',
      });
      assert.ok(result.includes('-i'));
      assert.ok(result.includes('Read your inbox'));
    });

    it('includes --model only for gemini model names', () => {
      const withGemini = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [], model: 'gemini-2.0-pro' });
      assert.ok(withGemini.includes('--model'));
      assert.ok(withGemini.includes('gemini-2.0-pro'));

      const withCodex = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [], model: 'gpt-5-codex' });
      assert.ok(!withCodex.includes('--model'), 'non-gemini model dropped');
    });

    it('returns only --approval-mode yolo when no optional args', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [] });
      assert.deepEqual(result, ['--approval-mode', 'yolo']);
    });
  });

  it('has correct static metadata', () => {
    assert.equal(provider.name, 'gemini');
    assert.equal(provider.binaryName, 'gemini');
    assert.equal(provider.guidanceFile(), 'AGENTS.md');
    assert.equal(provider.tui.mode, 'headless');
    assert.equal(provider.detectTrustPrompt('anything'), false);
  });
});

// ---------------------------------------------------------------------------
// OpenCodeProvider
// ---------------------------------------------------------------------------

describe('OpenCodeProvider', () => {
  let tmpDir: string;
  let configPath: string;
  let provider: OpenCodeProvider;

  beforeEach(async () => {
    tmpDir = realpathSync(await mkdtemp(join(tmpdir(), 'omx-opencode-test-')));
    configPath = join(tmpDir, 'opencode.json');
    class TestOpenCodeProvider extends OpenCodeProvider {
      override configPath() { return configPath; }
    }
    provider = new TestOpenCodeProvider();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('writeConfig()', () => {
    it('writes MCP servers to opencode.json', async () => {
      await provider.writeConfig(baseConfig({
        mcpServers: [mcpServer('omx_state'), mcpServer('omx_memory')],
      }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.ok(written.mcpServers.omx_state);
      assert.ok(written.mcpServers.omx_memory);
    });

    it('merges with existing config and preserves user keys', async () => {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(configPath, JSON.stringify({ apiKey: 'sk-test' }), 'utf-8');
      await provider.writeConfig(baseConfig({ mcpServers: [mcpServer('omx_state')] }));
      const written = JSON.parse(await readFile(configPath, 'utf-8'));
      assert.equal(written.apiKey, 'sk-test');
      assert.ok(written.mcpServers.omx_state);
    });

    it('is idempotent', async () => {
      const config = baseConfig({
        mcpServers: [mcpServer('omx_state')],
        model: 'gpt-5',
      });
      await provider.writeConfig(config);
      const first = await readFile(configPath, 'utf-8');
      await provider.writeConfig(config);
      const second = await readFile(configPath, 'utf-8');
      assert.equal(first, second);
    });
  });

  describe('buildLaunchArgs()', () => {
    it('appends --model when provided', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: [], model: 'gpt-5' });
      assert.ok(result.includes('--model'));
      assert.ok(result.includes('gpt-5'));
    });

    it('passes extraArgs through', () => {
      const result = provider.buildLaunchArgs({ bypassApprovals: true, extraArgs: ['--verbose'] });
      assert.ok(result.includes('--verbose'));
    });
  });

  it('has correct static metadata', () => {
    assert.equal(provider.name, 'opencode');
    assert.equal(provider.binaryName, 'opencode');
    assert.equal(provider.tui.mode, 'headless');
  });
});

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  it('get() throws for unknown provider with helpful message', () => {
    const registry = new ProviderRegistry();
    registry.register('codex', new CodexProvider());
    assert.throws(
      () => registry.get('unknown'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('"unknown"'));
        assert.ok(err.message.includes('codex'), 'lists available providers');
        return true;
      },
    );
  });

  it('has() returns true for registered providers', () => {
    const registry = new ProviderRegistry();
    registry.register('codex', new CodexProvider());
    assert.equal(registry.has('codex'), true);
    assert.equal(registry.has('claude'), false);
  });

  it('list() returns all registered names', () => {
    const registry = new ProviderRegistry();
    registry.register('codex', new CodexProvider());
    registry.register('claude', new ClaudeProvider());
    assert.deepEqual(registry.list().sort(), ['claude', 'codex']);
  });

  it('get() returns the registered provider', () => {
    const registry = new ProviderRegistry();
    const provider = new CodexProvider();
    registry.register('codex', provider);
    assert.equal(registry.get('codex'), provider);
  });

  it('register() overwrites an existing entry', () => {
    const registry = new ProviderRegistry();
    registry.register('codex', new CodexProvider());
    const replacement = new CodexProvider();
    registry.register('codex', replacement);
    assert.equal(registry.get('codex'), replacement);
  });
});
