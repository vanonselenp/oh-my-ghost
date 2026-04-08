/**
 * Shared TOML string escaping for oh-my-codex.
 *
 * Handles all TOML-spec control characters so that any string value
 * round-trips safely through a TOML parser.
 */

export function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}
