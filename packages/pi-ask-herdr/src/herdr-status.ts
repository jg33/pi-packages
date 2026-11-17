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

export interface AskBlockedStatus {
  kind: "question";
  message: string;
}

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
 * Button-bearing status for exactly one question whose option list carries two
 * or more usable labels (confirm's Yes/No, a select's options plus its custom
 * row); the bare first question otherwise (multi-question asks cannot be
 * answered by a single number press); `undefined` for an empty batch.
 */
export function askBlockedStatus(
  params: AskParams,
): AskBlockedStatus | undefined {
  const first = params.questions[0];
  if (!first) return undefined;
  const question = singleLine(first.question);

  if (params.questions.length !== 1) {
    return { kind: "question", message: question };
  }

  // Single source: the same questionOptions(q) the wizard and the transcript
  // line render — model options plus the custom row, or confirm's Yes/No.
  const labels = questionOptions(first)
    .map((item) => sanitizeLabel(item.label))
    .filter((label) => label.length > 0);
  if (labels.length < 2) return { kind: "question", message: question };
  return {
    kind: "question",
    message: `answer: ${question} (${labels.join(" · ")})`,
  };
}
