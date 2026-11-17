/**
 * Option normalization for select / multiselect.
 */

import type { AskQuestion, OptionItem, OptionObject } from "./types.ts";
import { CUSTOM_LABEL, CUSTOM_SENTINEL } from "./types.ts";

export function normalizeOptions(
  options: (string | OptionObject)[],
): OptionItem[] {
  return options.map((opt) => {
    if (typeof opt === "string") {
      return { label: opt, value: opt };
    }
    return { label: opt.label, value: opt.label, description: opt.description };
  });
}

/** Append the custom-value row — the one rule every select/multiselect surface shares. */
export function withCustomRow(items: OptionItem[]): OptionItem[] {
  return [...items, { value: CUSTOM_SENTINEL, label: CUSTOM_LABEL }];
}

/**
 * The full option list a question offers, in order — the single source the
 * wizard, the transcript line, and the panel's answer line all render.
 */
export function questionOptions(q: AskQuestion): OptionItem[] {
  if (q.type === "confirm") {
    const rows: OptionItem[] = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
    return q.allow_custom ? withCustomRow(rows) : rows;
  }
  if (q.type === "select" || q.type === "multiselect") {
    // Raw model args: a missing options array contributes no rows instead of
    // throwing; validation rejects it before any surface renders anyway.
    if (!Array.isArray(q.options)) return [];
    return withCustomRow(normalizeOptions(q.options));
  }
  return [];
}
