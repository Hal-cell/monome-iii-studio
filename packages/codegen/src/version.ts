/**
 * Codegen tool version.
 *
 * This string is embedded in the header comment of every emitted Lua script.
 * Bumping it intentionally breaks all golden tests — that is a feature, not
 * a bug: a version bump is a moment that deserves human review of every
 * emitter output.
 */
export const VERSION = '0.0.0';
