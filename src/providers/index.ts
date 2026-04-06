/**
 * CLI Provider abstraction layer — public API.
 */

export type {
  CliProvider,
  CliProviderCapabilities,
  LaunchOpts,
  OmxConfig,
  OmxMcpServer,
  TuiContract,
} from './types.js';

export { ProviderRegistry, globalRegistry, initBuiltinProviders, registerProvider } from './registry.js';

export { CodexProvider } from './codex.js';
export { ClaudeProvider } from './claude.js';
export { OpenCodeProvider } from './opencode.js';
export { GeminiProvider } from './gemini.js';
