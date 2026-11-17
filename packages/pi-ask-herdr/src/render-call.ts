/**
 * Line builder for the ask_user tool call as shown in the Pi transcript.
 *
 * local patch: upstream's renderCall only prints the header (plus the question
 * for a single-question call) — this renders one line per question with its
 * option labels. Re-apply after package updates from upstream.
 */

import { questionOptions } from "./options.ts";
import type { AskQuestion } from "./types.ts";

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One two-space-indented line per question: `1. <question> — <label> / <label>`. */
export function askCallLines(questions: AskQuestion[]): string[] {
  return questions.map((q, i) => {
    const question =
      typeof q.question === "string" ? singleLine(q.question) : "";
    const labels: string[] = [];
    // One source: the wizard, this transcript line, and the panel's answer
    // line all render questionOptions(q).
    for (const item of questionOptions(q)) {
      // renderCall gets raw model args: a missing label must not throw and an
      // empty one must stay out of `labels`, or a bare " / " would render.
      const label = singleLine(String(item.label ?? ""));
      if (label) labels.push(label);
    }
    const suffix = labels.length > 0 ? ` — ${labels.join(" / ")}` : "";
    return `  ${i + 1}. ${question}${suffix}`;
  });
}
