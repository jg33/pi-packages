import {
  prefix,
  stripBashCommentLines,
} from "#src/access-intent/bash/bash-arity";
import { sessionCommandIndex } from "#src/access-intent/bash/wrapper-analysis";
import {
  type CapabilityDirection,
  PATH_BEARING_TOOLS,
  surfaceFamilyMembers,
  surfaceFamilyOf,
} from "#src/access-intent/path-surfaces";
import { type ApprovalGrant, grantTargets } from "#src/session/approval-grant";

/** The suggestion returned for a "Yes, for this session" dialog option. */
export interface SessionApprovalSuggestion {
  /** The permission surface this approval applies to. */
  surface: string;
  /** The wildcard pattern to store as a session rule. */
  pattern: string;
  /** Human-readable label for the "for session" dialog option. */
  label: string;
}

/**
 * Suggest a bash session-approval pattern from a command string.
 *
 * Uses the arity table (`src/bash-arity.ts`) to identify the semantically
 * meaningful prefix tokens for the command, then produces a wildcard pattern:
 *
 * - Single bare token (no args): exact command (`ls`).
 * - Arity prefix covers all tokens: trailing wildcard (`npm run build*`).
 * - Arity prefix shorter than token list: space + wildcard (`git checkout *`).
 * - Unknown command: first token + space wildcard (`mytool *`).
 * - Recognized wrapper: its words, then the inner command's arity prefix,
 *   then a space wildcard (`sudo -u root nohup mytool *`).
 * - Wrapper whose inner command cannot be proven: the exact command, with no
 *   wildcard (`watch mytool x`).
 */
export function suggestBashPattern(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  // Strip leading shell comment lines so the suggestion is based on the
  // actual command, not a `# description` prefix agents often prepend.
  const stripped = stripBashCommentLines(trimmed);
  if (!stripped) return "";
  const tokens = stripped.split(/\s+/);
  if (tokens.length === 1) return stripped;
  // A wrapper's words are split only where bash splits them: `\s` also splits
  // on a non-breaking space or `\r`, which would read `rm<NBSP>-rf` as `rm`.
  const words = stripped.split(BASH_BLANKS);
  const commandIndex = sessionCommandIndex(words);
  if (commandIndex === null) return stripped;
  if (commandIndex > 0) return wrappedPattern(words, commandIndex);
  const meaningful = prefix(tokens);
  if (meaningful.length >= tokens.length) {
    return `${stripped}*`;
  }
  return `${meaningful.join(" ")} *`;
}

/** The blanks bash splits a command's words on. */
const BASH_BLANKS = /[ \t\n]+/;

/**
 * The wrapper words kept literally, then the inner command's arity prefix.
 *
 * The wildcard always follows a space, even when the arity prefix covers every
 * token, so approving `nohup mytool` never approves `nohup mytool-other`; the
 * matcher treats a trailing space and wildcard as optional, so the bare
 * command is still covered.
 */
function wrappedPattern(
  tokens: readonly string[],
  commandIndex: number,
): string {
  const meaningful = [
    ...tokens.slice(0, commandIndex),
    ...prefix(tokens.slice(commandIndex)),
  ];
  return `${meaningful.join(" ")} *`;
}

/**
 * Suggest an MCP session-approval pattern from a resolved target string.
 *
 * - Qualified target (`server:tool`) → `server:*`
 * - Munged target (`server_tool`) → `server_*`
 * - Bare target (no separator) → `*`
 */
export function suggestMcpPattern(target: string): string {
  const trimmed = target.trim();

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0) {
    return `${trimmed.slice(0, colonIndex)}:*`;
  }

  const underscoreIndex = trimmed.indexOf("_");
  if (underscoreIndex > 0) {
    return `${trimmed.slice(0, underscoreIndex)}_*`;
  }

  return "*";
}

/**
 * What an approval's grants cover, as one phrase.
 *
 * A single target names its pattern; several name their count, because only
 * the external-directory gate aggregates an ask over many paths and there is
 * no pattern that describes them all. Targets, not grants: a directory's
 * two-grant approval and two paths sharing one glob each count once
 * ({@link grantTargets}). Requires at least one grant — an approval
 * with none is never offered as a session option.
 */
export function describeGrantTarget(grants: readonly ApprovalGrant[]): string {
  const targets = grantTargets(grants);
  return targets.length === 1 ? `"${targets[0]}"` : `${targets.length} paths`;
}

/** The two session-option labels for an ask whose grants prove one direction. */
export interface DirectionalSessionLabels {
  /** The proven-direction grant — the least-privilege default. */
  sessionLabel: string;
  /** The both-directions grant, offered beside it (#813). */
  widenedLabel: string;
}

const DIRECTION_NOUNS: Record<CapabilityDirection, string> = {
  read: "reads",
  write: "writes",
};

/**
 * Label the two widths a directional ask's session grant can take.
 *
 * Both rows name the direction and the target, so the choice between them
 * contrasts on a stated axis rather than on "wider" (#813).
 */
export function buildDirectionalSessionLabels(
  direction: CapabilityDirection,
  target: string,
): DirectionalSessionLabels {
  return {
    sessionLabel: `Yes, allow ${DIRECTION_NOUNS[direction]} to ${target} for this session`,
    widenedLabel: `Yes, allow ${DIRECTION_NOUNS.read} and ${DIRECTION_NOUNS.write} to ${target} for this session`,
  };
}

/**
 * Label a session grant on the `path` / `external_directory` families that
 * proves no direction (an extension tool, `edit`), so the option still names
 * its scope instead of the dialog's bare default. Returns `null` when any
 * grant lies outside those families — their gates supply their own label.
 */
export function buildPathAccessSessionLabel(
  grants: readonly ApprovalGrant[],
): string | null {
  const allPathFamily =
    grants.length > 0 &&
    grants.every(
      (grant) => surfaceFamilyMembers(surfaceFamilyOf(grant.surface)) !== null,
    );
  return allPathFamily
    ? `Yes, allow access to ${describeGrantTarget(grants)} for this session`
    : null;
}

/** Surface-aware human-readable labels for the session-approval option. */
function buildLabel(pattern: string, surface: string): string {
  switch (surface) {
    case "bash":
      return `Yes, allow bash "${pattern}" for this session`;
    case "mcp":
      return `Yes, allow mcp tool "${pattern}" for this session`;
    case "skill":
      return `Yes, allow skill "${pattern}" for this session`;
    case "external_directory":
      return `Yes, allow access to external directory "${pattern}" for this session`;
    case "path":
      return `Yes, allow path "${pattern}" for this session`;
    default:
      // Path-bearing tools with a specific path pattern show the pattern.
      if (PATH_BEARING_TOOLS.has(surface) && pattern !== "*") {
        return `Yes, allow ${surface} "${pattern}" for this session`;
      }
      // Tool surfaces with catch-all or extension tools.
      return `Yes, allow tool "${surface}" for this session`;
  }
}

/**
 * Suggest a session-approval pattern from a surface's own value vocabulary —
 * a bash command, an MCP target, a skill name.
 *
 * Returns a `SessionApprovalSuggestion` with the surface, the wildcard pattern
 * to store in `SessionRules`, and a human-readable dialog label. Any surface
 * with no vocabulary of its own falls back to the catch-all wildcard, which is
 * also what a path-bearing tool invoked without a path resolves to.
 *
 * A path surface goes through {@link suggestPathSessionPattern} instead: its
 * pattern is a path-language product, and this module holds no path semantics.
 */
export function suggestSessionPattern(
  surface: string,
  value: string,
): SessionApprovalSuggestion {
  let pattern: string;

  switch (surface) {
    case "bash":
      pattern = suggestBashPattern(value);
      break;
    case "mcp":
      pattern = suggestMcpPattern(value);
      break;
    case "skill":
      pattern = value;
      break;
    default:
      // Extension tools, and path-bearing tools invoked without a path.
      pattern = "*";
      break;
  }

  return { surface, pattern, label: buildLabel(pattern, surface) };
}

/** The suggestion for a path surface: every pattern to record, one label. */
export interface PathSessionSuggestion {
  /** The permission surface this approval applies to. */
  surface: string;
  /** The wildcard patterns to store as session rules. */
  patterns: readonly string[];
  /** Human-readable label for the "for session" dialog option. */
  label: string;
}

/**
 * Build the suggestion for a path surface from patterns the caller already
 * derived through its `PathNormalizer` (#655).
 *
 * The derivation belongs to the normalizer, which owns the session's
 * `PathFlavor`; this module labels the result and must not re-interpret the
 * separators it is handed. The label names the approval's target
 * ({@link grantTargets}), so a directory's pair reads as its contents glob.
 */
export function suggestPathSessionPattern(
  surface: string,
  approvalPatterns: readonly string[],
): PathSessionSuggestion {
  const targets = grantTargets(
    approvalPatterns.map((pattern) => ({ surface, pattern })),
  );
  return {
    surface,
    patterns: approvalPatterns,
    label: buildLabel(targets.join('", "'), surface),
  };
}

/**
 * Build the suggestion for a pattern the caller already holds verbatim, such
 * as a Pi MCP tool's full name on the `mcp` surface: no wildcard is derived.
 */
export function suggestExactSessionPattern(
  surface: string,
  pattern: string,
): SessionApprovalSuggestion {
  return { surface, pattern, label: buildLabel(pattern, surface) };
}
