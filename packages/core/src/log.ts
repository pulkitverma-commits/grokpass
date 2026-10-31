// The one approved logging path for screens and adapters (docs/mobile/test-plan.md §1.6, task Q4).
//
// OnePeek ships no telemetry and never prints: `log()` is a no-op in every build, and the lint
// (`no-restricted-syntax` in packages/core and apps/mobile) refuses every other sink: the console,
// crash reporters, analytics SDKs and ad-hoc `logger.*` objects. Call sites still pass their fields
// through `redact()`, so that if a sink is ever wired in here (a decision for the lead and the
// security reviewer, never for a screen) nothing sensitive can reach it by accident.
//
//   log('room_open', redact({ roomId, memberCount }));
//
// Keep this file tiny: it is imported by the app's first render.

/** Keys whose values are never kept. Matched case-insensitively anywhere in the key. */
export const SENSITIVE_KEY =
  /message|body|plain|text|token|access|code|secret|key|nick|file|name|password|email|link|url|session|jwt|state/i;

export const REDACTED = '[redacted]';

/** Longest string kept verbatim under a non-sensitive key. */
export const MAX_STRING = 32;

/** Deepest level walked; anything below is summarised. */
export const MAX_DEPTH = 4;

export type LogFields = Record<string, unknown>;

/**
 * Returns a copy of `value` safe to hand to any sink: sensitive keys are replaced by `REDACTED`,
 * strings are capped, byte buffers become their length, errors keep only their name and the
 * trailing `[a-z_]+` code that `ChatError` uses. A bare string has no key to judge it by, so it
 * is redacted whole.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'string') return depth === 0 ? REDACTED : clip(value);
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (value instanceof Error) return { error: value.name, code: codeOf(value.message) };
  if (value instanceof ArrayBuffer) return `[bytes:${value.byteLength}]`;
  if (ArrayBuffer.isView(value)) return `[bytes:${value.byteLength}]`;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map || value instanceof Set) return `[${value instanceof Map ? 'map' : 'set'}:${value.size}]`;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(value as object)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  return out;
}

/** Records nothing. Exists so screens have exactly one place to call, and the lint one place to allow. */
export function log(event: string, fields?: LogFields): void {
  void event;
  void fields;
}

function clip(s: string): string {
  return s.length <= MAX_STRING ? s : `${s.slice(0, MAX_STRING)}…[${s.length}]`;
}

function codeOf(message: string): string | null {
  const m = /([a-z_]+)$/.exec(message);
  return m ? m[1] : null;
}
