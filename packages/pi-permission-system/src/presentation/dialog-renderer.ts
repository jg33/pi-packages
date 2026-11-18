import {
  describeBashCommandContext,
  describeDecidingPath,
  flaggedElements,
  valueLabel,
} from "./fact-vocabulary";
import { fitLinesToWidth } from "./line-fitting";
import { annotationSourceLabel } from "./printable-text";
import type { PromptAnnotation, PromptPayload } from "./prompt-payload";

/**
 * Render a {@link PromptPayload} for a human deciding an ask (ADR 0011 §5).
 *
 * The payload is complete by contract, so this is where elision happens: the
 * dialog and the `select`/`input` fallback both render through here under
 * their own budget, which is what makes a bounded prompt a property of the
 * render rather than of what the gate assembled.
 *
 * The layout is one fact per line, `label : value`, labels aligned. A fact
 * whose text an earlier line already carries is not repeated — a bash ask's
 * gate surface is its tool name, and a generic tool ask's value is the tool —
 * so every line the render spends states something new.
 *
 * Annotations follow the evidence as a separate, marked region and are the
 * first thing a row budget drops.
 */
export function renderPromptDialog(
  payload: PromptPayload,
  budget: DialogBudget,
  paint: HighlightPaint = plainText,
): DialogView {
  const request = requestFacts(payload, budget.fieldMaxWidth);
  // The request line capped its own value; capping the joined line as well
  // would spend the budget on the one-word facets in front of it.
  const core = request.facts.map((fact) =>
    fact.label === REQUEST_LABEL
      ? { ...fact, clipped: false }
      : capField(fact, budget.fieldMaxWidth),
  );
  const evidence = evidenceFacts(payload).map((fact) =>
    capField(fact, budget.fieldMaxWidth),
  );
  const annotations = annotationFacts(payload).map((fact) =>
    capField(fact, budget.fieldMaxWidth),
  );
  const blocks = layout(
    [...core, ...evidence],
    flaggedElements(payload),
    paint,
  ).map((block) => fitLinesToWidth(block, budget.width));
  // The advisory is laid out apart from the facts: its own label column, so it
  // cannot realign the evidence, and no highlight, so model text is never
  // painted as the thing the rule fired on. Appended after the evidence, it is
  // what `fitToRows` drops first.
  const advisory = layout(annotations, [], plainText).map((block) =>
    fitLinesToWidth(block, budget.width),
  );
  const fitted = fitToRows(
    blocks.slice(0, core.length).flat(),
    [...blocks.slice(core.length), ...advisory],
    budget.maxRows,
  );
  return {
    lines: fitted.lines,
    elided:
      fitted.dropped ||
      request.clipped ||
      [...core, ...evidence, ...annotations].some((fact) => fact.clipped),
  };
}

/**
 * How much room a render has, as the operator configured it.
 *
 * Separate from the terminal width, which only the component rendering a frame
 * knows — the configured half is read once per ask, the width once per frame.
 */
export interface RenderBudget {
  /** Maximum rendered rows. */
  readonly maxRows: number;
  /** Maximum characters of any one field's text. */
  readonly fieldMaxWidth: number;
}

/** A {@link RenderBudget} against the width its rows are counted at. */
export interface DialogBudget extends RenderBudget {
  /** Terminal width the lines are wrapped to, so a row count is meaningful. */
  readonly width: number;
}

/**
 * The budget when the operator configures neither field.
 *
 * Twenty-four rows plus the decision options and the hint fit a thirty-row
 * terminal; four hundred characters is roughly four wrapped rows, which is what
 * actually bounds a here-string command.
 */
export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  maxRows: 24,
  fieldMaxWidth: 400,
};

/** The two prompt-budget knobs, as the extension config carries them. */
export interface PromptBudgetConfig {
  readonly promptMaxRows?: number;
  readonly promptFieldMaxWidth?: number;
}

/** The configured budget, falling back per field to {@link DEFAULT_RENDER_BUDGET}. */
export function resolveRenderBudget(config: PromptBudgetConfig): RenderBudget {
  return {
    maxRows: config.promptMaxRows ?? DEFAULT_RENDER_BUDGET.maxRows,
    fieldMaxWidth:
      config.promptFieldMaxWidth ?? DEFAULT_RENDER_BUDGET.fieldMaxWidth,
  };
}

/**
 * Paints the flagged element — the command, path, or target the rule fired on.
 *
 * A render concern, so the fallback and the review log pass nothing: only the
 * TUI has a theme to paint with.
 */
export type HighlightPaint = (text: string) => string;

/** What a renderer produced, and whether it had to leave anything out. */
export interface DialogView {
  /** Wrapped to the budget's width: each entry is one visual row. */
  readonly lines: readonly string[];
  /** True when any field was shortened or any entry dropped. */
  readonly elided: boolean;
}

/**
 * The budget that elides nothing — the complete view an operator must be able
 * to reach while the decision is pending (ADR 0011 §4).
 */
export function completeViewBudget(width: number): DialogBudget {
  return {
    maxRows: Number.POSITIVE_INFINITY,
    fieldMaxWidth: Number.POSITIVE_INFINITY,
    width,
  };
}

const plainText: HighlightPaint = (text) => text;

/** One rendered fact. */
interface Fact {
  readonly label: string;
  readonly text: string;
}

/** A fact narrowed to the budget, and whether that cost it anything. */
interface CappedFact extends Fact {
  readonly clipped: boolean;
}

/**
 * Narrow one field's text to the budget.
 *
 * A quantity bound applied uniformly, never a content filter: it does not read
 * the value to decide what to hide, which is what keeps it a cap rather than
 * redaction (ADR 0010). The marker is a bare ellipsis — a character or line
 * count is a number the operator cannot act on, and ADR 0011 §4 rejects it in
 * favour of reaching the complete view.
 */
function capField(fact: Fact, fieldMaxWidth: number): CappedFact {
  if (fact.text.length <= fieldMaxWidth) {
    return { ...fact, clipped: false };
  }
  return {
    ...fact,
    text: `${fact.text.slice(0, fieldMaxWidth)}\u2026`,
    clipped: true,
  };
}

/**
 * Fit the rendered blocks into the row budget.
 *
 * The core is exempt and the evidence is what gives way: §3 outranks §5, so a
 * core that alone overruns the budget still renders whole — the field cap is
 * what bounds it, and the row budget is what bounds the evidence. A drop costs
 * one row for its marker, taken only when there is something to mark.
 */
function fitToRows(
  core: readonly string[],
  evidence: readonly (readonly string[])[],
  maxRows: number,
): { lines: string[]; dropped: boolean } {
  const total = evidence.reduce((rows, block) => rows + block.length, 0);
  if (core.length + total <= maxRows) {
    return { lines: [...core, ...evidence.flat()], dropped: false };
  }
  const limit = maxRows - ELISION_MARKER_ROWS;
  const lines = [...core];
  for (const block of evidence) {
    // An entry is shown whole or not at all: half a path is worse evidence
    // than none, and the reader cannot tell the halves apart.
    if (lines.length + block.length > limit) {
      break;
    }
    lines.push(...block);
  }
  if (lines.length < maxRows) {
    lines.push(ELISION_MARKER);
  }
  return { lines, dropped: true };
}

/**
 * What an elision states: that there is more, and nothing else.
 *
 * Character and line counts were considered and rejected (ADR 0011 §4) — they
 * are a number the operator cannot act on, and they spend budget the evidence
 * itself should hold.
 */
const ELISION_MARKER = "\u2026";
const ELISION_MARKER_ROWS = 1;

/**
 * The invariant core (ADR 0011 §3), in reading order: who is asking, what the
 * ask is — tool, surface, rule and the decision-relevant value as one line —
 * then the sentences that explain it.
 *
 * One line for the facets rather than four: `tool`, `surface`, `rule` and the
 * value are four words about one request, and stacking them spent four rows to
 * say one thing (#PPB-8). What survives as its own row is what reads as a
 * sentence — why a path ask landed on its direction, what will actually run,
 * and where a substitution runs.
 */
function requestFacts(
  payload: PromptPayload,
  fieldMaxWidth: number,
): { facts: Fact[]; clipped: boolean } {
  const { request } = payload;
  const facts: Fact[] = [];
  const requester = requesterFact(payload);
  if (requester) {
    facts.push(requester);
  }
  const line = requestLine(payload, fieldMaxWidth);
  if (line.text !== null) {
    facts.push({ label: REQUEST_LABEL, text: line.text });
  }
  if (request.matchedSpelling !== null) {
    facts.push({ label: "matched as", text: request.matchedSpelling });
  }
  const why = describeDecidingPath(payload);
  if (why !== undefined) {
    facts.push({ label: "why", text: why });
  }
  if (request.executedUnit !== null) {
    facts.push({ label: "runs", text: request.executedUnit });
  }
  const context = describeBashCommandContext(request.commandContext);
  if (context !== undefined) {
    facts.push({ label: "context", text: context });
  }
  return { facts, clipped: line.clipped };
}

/**
 * The request's own facets, joined: `tool · surface · rule · value`.
 *
 * Positional rather than labelled, because the order is the statement — what
 * was called, what gated it, on what pattern, about what. A facet that says
 * nothing new is left out: the surface is stated when it *is* the tool name (a
 * bash ask) or when it is the word the value would be labelled with (a path ask
 * reads `read · /tmp/x`).
 */
function requestLine(
  payload: PromptPayload,
  fieldMaxWidth: number,
): { text: string | null; clipped: boolean } {
  const { request } = payload;
  const parts: string[] = [];
  if (request.toolName !== null) {
    parts.push(toolText(payload));
  }
  const label = valueLabel(payload);
  if (request.surface !== request.toolName && request.surface !== label) {
    parts.push(request.surface);
  }
  if (request.matchedPattern !== null) {
    parts.push(request.matchedPattern);
  }
  // The cap is the value's own: the facets in front of it are one word each,
  // and capping the joined line would spend the budget on them and clip the
  // thing the human is deciding about (#PPB-8).
  const value = capText(
    request.value !== "" && request.value !== request.toolName
      ? request.value
      : null,
    fieldMaxWidth,
  );
  if (value.text !== null) {
    parts.push(value.text);
  }
  return {
    text: parts.length === 0 ? null : parts.join(" · "),
    clipped: value.clipped,
  };
}

/** Narrow one field's text to the budget, or pass `null` through. */
function capText(
  text: string | null,
  fieldMaxWidth: number,
): { text: string | null; clipped: boolean } {
  if (text === null || text.length <= fieldMaxWidth) {
    return { text, clipped: false };
  }
  return { text: `${text.slice(0, fieldMaxWidth)}\u2026`, clipped: true };
}

/**
 * The decision evidence, in payload order.
 *
 * An entry's `detail` rides its own line rather than becoming a second entry,
 * so an elision can never show a path while dropping what it resolves to.
 *
 * The working directory is not rendered: the request line already names what
 * the ask is about, and for an ask about a path inside that directory the two
 * rows said the same thing twice (#PPB-8). The entry stays in the payload —
 * this is one render's choice, not the gate's.
 */
function evidenceFacts(payload: PromptPayload): Fact[] {
  return payload.evidence
    .filter((entry) => entry.label !== WORKING_DIRECTORY_LABEL)
    .map((entry) => ({
      label: entry.label,
      text:
        entry.detail === null ? entry.text : `${entry.text} → ${entry.detail}`,
    }));
}

/** The label the ask's own facets are joined under. */
const REQUEST_LABEL = "request";

/** The evidence label this dialog leaves to the request line. */
const WORKING_DIRECTORY_LABEL = "working directory";

/**
 * The annotations, each under the label the operator reads it by.
 *
 * Read off the slot rather than composed here: the marking is a property of the
 * payload (ADR 0011 §8), and this only chooses the *word* in front of it. A
 * model summary is what the human calls an explanation; a chain verdict says
 * whose verdict it is; any other annotator keeps its registered name rather
 * than disappearing into a generic label.
 */
function annotationFacts(payload: PromptPayload): Fact[] {
  return (
    payload.annotations
      // A fact whose text says nothing spends a row and reads as a render fault,
      // so a blank answer is the same as no answer (fail-safe, ADR 0011 §8).
      .filter((annotation) => annotation.text.trim() !== "")
      .map((annotation) => ({
        label: annotationLabel(annotation),
        text: annotation.text,
      }))
  );
}

/**
 * The words a human reads for the annotators everything uses.
 *
 * Only a name on this map may drop the marking, and only because its own word
 * says what the text is: a summary is an explanation, a chain verdict is the
 * chain's. An annotator nobody has named here keeps the payload's marking
 * verbatim, so an unknown or hostile annotator cannot present its text as
 * anything but model-generated.
 */
const ANNOTATION_LABELS: ReadonlyMap<string, string> = new Map([
  ["model-summary", "Explanation"],
  ["jev-verdict", "jev"],
]);

/** One annotation's display label, from the payload's stamped facts alone. */
function annotationLabel(annotation: PromptAnnotation): string {
  const friendly = ANNOTATION_LABELS.get(annotation.source);
  if (friendly !== undefined) {
    return friendly;
  }
  return `${annotation.marking} (${annotationSource(annotation.source)})`;
}

/** Longest annotator name a label carries, so the label column stays bounded. */
const ANNOTATION_SOURCE_MAX = 40;

/** One annotator name, printable and capped, for the label column. */
function annotationSource(source: string): string {
  return annotationSourceLabel(source, ANNOTATION_SOURCE_MAX);
}

/**
 * Who is asking.
 *
 * A forwarded ask always names its requester — that the ask came from a
 * subagent is itself a core fact — while an unnamed local requester states
 * nothing, and a line asserting the default would spend a row saying so.
 */
function requesterFact(payload: PromptPayload): Fact | undefined {
  const { agentName, forwarded, sessionId } = payload.request.requester;
  if (!forwarded) {
    return agentName ? { label: "agent", text: agentName } : undefined;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: a version-skewed request carries "" rather than null
  const name = agentName || "unknown";
  return {
    label: "subagent",
    text: sessionId ? `${name} · session ${sessionId}` : name,
  };
}

/** The gated tool, and the name the agent actually called when they differ. */
function toolText(payload: PromptPayload): string {
  const { toolName, invokedToolName } = payload.request;
  return invokedToolName === null
    ? String(toolName)
    : `${String(toolName)} (invoked as ${invokedToolName})`;
}

/**
 * Align the labels into a `label : value` column.
 *
 * A field carrying its own newlines (a here-string, a multi-line preview)
 * continues under the column rather than back at the margin, so the eye can
 * still tell a continuation from the next fact.
 */
function layout(
  facts: readonly Fact[],
  flagged: readonly string[],
  paint: HighlightPaint,
): string[][] {
  const width = Math.max(0, ...facts.map((fact) => fact.label.length));
  const indent = " ".repeat(width + 3);
  return facts.map((fact) => {
    // A fact that *is* the flagged element paints whole; any other line paints
    // the whole-token occurrences of it, so `ls` stays plain inside `lsof`.
    const highlight = flagged.includes(fact.text)
      ? paint
      : (line: string) => paintTokens(line, flagged, paint);
    return fact.text
      .split("\n")
      .map((line, index) =>
        index === 0
          ? `${fact.label.padEnd(width)} : ${highlight(line)}`
          : indent + highlight(line),
      );
  });
}

/** Characters a path, command, or target may contain, so a match is a whole token. */
const TOKEN_CHARACTER = /[\w/.-]/;

/** Paint every whole-token occurrence of each flagged text within one line. */
function paintTokens(
  line: string,
  flagged: readonly string[],
  paint: HighlightPaint,
): string {
  return flagged.reduce(
    (painted, needle) => paintOccurrences(painted, needle, paint),
    line,
  );
}

function paintOccurrences(
  line: string,
  needle: string,
  paint: HighlightPaint,
): string {
  if (needle === "" || needle.includes("\n")) {
    return line;
  }
  let result = "";
  let cursor = 0;
  for (
    let at = line.indexOf(needle, cursor);
    at !== -1;
    at = line.indexOf(needle, cursor)
  ) {
    const end = at + needle.length;
    const whole =
      !TOKEN_CHARACTER.test(line[at - 1] ?? " ") &&
      !TOKEN_CHARACTER.test(line[end] ?? " ");
    result += line.slice(cursor, at) + (whole ? paint(needle) : needle);
    cursor = end;
  }
  return result + line.slice(cursor);
}
