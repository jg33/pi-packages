/**
 * The `blocked` option for the ask_user wizard's `ctx.ui.custom` call.
 *
 * The Pi host itself reports OSC 7501 program status from a dialog's `blocked`
 * option (honored only when `overlay` is false), and herdr's Asks panel turns
 * the message into clickable buttons when `kind === "question"` and the message
 * matches `answer: <question> (<label> · <label>)` — separator is space U+00B7
 * space.
 *
 * local patch: herdr-agent-ask parses "answer: <q> (a · b)" for clickable
 * buttons; re-apply after package updates from upstream.
 */

import { questionOptions } from "./options.ts";
import type { AskParams } from "./types.ts";
import { CUSTOM_SENTINEL } from "./types.ts";

export interface AskBlockedStatus {
  kind: "question";
  message: string;
}

// pi's formatProgramStatus caps the status message at 2048 UTF-8 bytes
// (MAX_MESSAGE_BYTES, pi 1.5.2). Truncation drops the closing ')', so
// parseReport finds no answer: wrapper and the card falls back to a
// free-text box on a select dialog — the silent wrong answer again. An
// over-cap wrapper falls through to `choose in terminal:`, whose prefix
// sits at the front of the message and survives truncation.
const MAX_STATUS_BYTES = 2048;

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bracketParens(text: string): string {
  // herdr's option-list regex allows one nesting level; an unbalanced paren silently kills the buttons.
  return text.replace(/\(/g, "[").replace(/\)/g, "]");
}

function sanitizeLabel(label: string): string {
  // herdr splits the option list on " · " (space U+00B7 space); a label containing
  // that sequence would become two options and shift every later number — neutralize U+00B7.
  const text = label.replace(/\s+/g, " ").trim().replace(/·/g, "-");
  // Keep the literal `(recommended)` marker (herdr: /\(recommended\)/i) intact —
  // it must survive as parens, never become `[recommended]` — and bracket every
  // other paren around it.
  let out = "";
  let cursor = 0;
  for (const m of text.matchAll(/\(recommended\)/gi)) {
    const at = m.index ?? cursor;
    out += bracketParens(text.slice(cursor, at)) + m[0];
    cursor = at + m[0].length;
  }
  return out + bracketParens(text.slice(cursor));
}

/**
 * Status for the question the wizard is showing (`index`; the wire format
 * carries one question and one option set), in one of three shapes:
 * - `answer: <question> (<label> · …)` — a select/confirm whose 2–9 real labels
 *   are each digit-addressable (the custom row stays off the wire — the
 *   consumer filters it anyway);
 * - `choose in terminal: <question>` — a select/confirm/multiselect the panel
 *   must not offer buttons for (digit count out of window, a label that
 *   sanitizes to empty, or any multiselect — a digit toggles and stays);
 * - the bare question — text, where free text genuinely answers it;
 * `undefined` when there is no such question.
 */
export function askBlockedStatus(
  params: AskParams,
  index = 0,
): AskBlockedStatus | undefined {
  const current = params.questions[index];
  if (!current) return undefined;
  const question = singleLine(current.question);
  const type = current.type ?? "text";

  // Single source: the same questionOptions(q) the wizard and the transcript
  // line render — minus the custom row, identified by its sentinel value (a
  // model label may legitimately start with ✎). Empty sanitizations are kept:
  // a blank still consumes a digit position in the wizard.
  const labels = questionOptions(current)
    .filter((item) => item.value !== CUSTOM_SENTINEL)
    .map((item) => sanitizeLabel(item.label));
  // 9 is the ceiling: pickByDigit (src/ui.ts) dispatches only '1'–'9', so a
  // 10th button would arrive as the keystrokes '1','0' and silently pick option 1.
  const digitAnswerable =
    (type === "select" || type === "confirm") &&
    labels.length >= 2 &&
    labels.length <= 9 &&
    labels.every((label) => label.length > 0);
  if (digitAnswerable) {
    const message = `answer: ${question} (${labels.join(" · ")})`;
    if (new TextEncoder().encode(message).length <= MAX_STATUS_BYTES) {
      return { kind: "question", message };
    }
    // Over cap: fall through to `choose in terminal:` below.
  }
  // MF2/MF3: no buttons — tell the consumer so it shows no Answer box and
  // points at the terminal instead; the consumer maps this prefix to UNCLEAR.
  if (type === "select" || type === "confirm" || type === "multiselect") {
    return { kind: "question", message: `choose in terminal: ${question}` };
  }
  return { kind: "question", message: question };
}
