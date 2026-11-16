/**
 * Line builder for the ask_user tool call as shown in the Pi transcript.
 *
 * local patch: upstream's renderCall only prints the header (plus the question
 * for a single-question call) — this renders one line per question with its
 * option labels. Re-apply after package updates from upstream.
 */

import { normalizeOptions } from "./options.ts";
import { CUSTOM_LABEL } from "./types.ts";
import type { AskQuestion } from "./types.ts";

function singleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** One two-space-indented line per question: `1. <question> — <label> / <label>`. */
export function askCallLines(questions: AskQuestion[]): string[] {
	return questions.map((q, i) => {
		const question = typeof q.question === "string" ? singleLine(q.question) : "";
		const labels: string[] = [];
		if (q.type === "select" || q.type === "multiselect") {
			// renderCall gets raw model args and normalizeOptions calls .map directly —
			// a non-array must contribute no labels instead of throwing.
			if (Array.isArray(q.options)) {
				for (const item of normalizeOptions(q.options)) {
					// renderCall gets raw model args: a missing label must not throw and an
					// empty one must stay out of `labels`, or a bare " / " would render.
					const label = singleLine(String(item.label ?? ""));
					if (label) labels.push(label);
				}
				// The dialog appends its custom row for select/multiselect unconditionally
				// (src/ui.ts), so mirror it here — not gated on allow_custom.
				labels.push(CUSTOM_LABEL);
			}
		} else if (q.type === "confirm") {
			labels.push("Yes", "No");
			if (q.allow_custom) labels.push(CUSTOM_LABEL);
		}
		const suffix = labels.length > 0 ? ` — ${labels.join(" / ")}` : "";
		return `  ${i + 1}. ${question}${suffix}`;
	});
}
