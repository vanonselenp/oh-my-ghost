/**
 * Provider registry for oh-my-codex.
 *
 * Manages the set of available CLI providers and exposes a global
 * singleton used throughout the runtime.
 *
 * Built-in providers (codex, claude, opencode, gemini) are registered
 * eagerly at module load time so callers don't need to await
 * initBuiltinProviders() before using the registry.
 */

import type { CliProvider } from './types.js';
import { CodexProvider } from './codex.js';
import { ClaudeProvider } from './claude.js';
import { OpenCodeProvider } from './opencode.js';
import { GeminiProvider } from './gemini.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, CliProvider>();

  /** Register a provider under its canonical name. */
  register(name: string, provider: CliProvider): void {
    this.providers.set(name, provider);
  }

  /** Look up a provider by name. Throws if not registered. */
  get(name: string): CliProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      const available = this.list().join(', ') || '(none)';
      throw new Error(
        `Unknown CLI provider "${name}". Available providers: ${available}.`,
      );
    }
    return provider;
  }

  /** Check whether a provider is registered. */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** Return all registered provider names. */
  list(): string[] {
    return [...this.providers.keys()];
  }
}

/**
 * Global singleton registry used by the OMX runtime.
 *
 * Built-in providers are registered eagerly at module load time.
 * External providers can be added via `registerProvider()` before the
 * runtime starts, but the registry is not designed for hot-swapping
 * providers at runtime — trust prompt detection and CLI map resolution
 * assume a closed, stable set of provider names within a single process.
 */
export const globalRegistry = new ProviderRegistry();

// Register built-in providers eagerly so they are available without
// needing to await initBuiltinProviders().
globalRegistry.register('codex', new CodexProvider());
globalRegistry.register('claude', new ClaudeProvider());
globalRegistry.register('opencode', new OpenCodeProvider());
globalRegistry.register('gemini', new GeminiProvider());

/**
 * Initialise the registry with all built-in providers.
 * No-op — providers are registered eagerly above.
 * Kept for backward compatibility with callers that await this.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function initBuiltinProviders(): Promise<void> {
  // Built-in providers are already registered at module load time.
}

/**
 * Synchronous variant — kept for backward compatibility.
 */
export function registerProvider(name: string, provider: CliProvider): void {
  globalRegistry.register(name, provider);
}
