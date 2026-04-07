/**
 * Shared utilities for CliProvider implementations.
 *
 * Providers should call these instead of duplicating the same logic.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolveCommandPathForPlatform } from '../utils/platform-command.js';

const OMX_GUIDANCE_MARKER_START = '<!-- OMX:TEAM:WORKER:START -->';
const OMX_GUIDANCE_MARKER_END = '<!-- OMX:TEAM:WORKER:END -->';

/**
 * Inject OMX runtime guidance into a provider's guidance file.
 * Strips any previous OMX overlay before writing the new one.
 */
export async function injectGuidanceToFile(
  filePath: string,
  guidance: string,
): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet; start empty.
  }

  const startIdx = existing.indexOf(OMX_GUIDANCE_MARKER_START);
  const endIdx = existing.indexOf(OMX_GUIDANCE_MARKER_END);
  let base = existing;
  if (startIdx !== -1 && endIdx !== -1) {
    base =
      existing.slice(0, startIdx) +
      existing.slice(endIdx + OMX_GUIDANCE_MARKER_END.length);
  }

  const injected = `${base.trimEnd()}\n\n${OMX_GUIDANCE_MARKER_START}\n${guidance}\n${OMX_GUIDANCE_MARKER_END}\n`;
  await writeFile(filePath, injected, 'utf-8');
}

/**
 * Assert that a provider's CLI binary is available on PATH.
 * Throws with a descriptive message if not found.
 */
export function assertProviderBinaryAvailable(
  binaryName: string,
  installInstructions: string,
): void {
  const resolved = resolveCommandPathForPlatform(binaryName);
  if (!resolved) {
    throw new Error(
      `CLI binary "${binaryName}" not found on PATH. ${installInstructions}`,
    );
  }
}
