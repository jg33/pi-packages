/**
 * printable-text.ts — the one place this package knows how to make untrusted
 * text safe for a terminal. Shared by the annotation runner (advisory bodies)
 * and the dialog renderer (annotation labels), so the two cannot drift.
 *
 * The dialog's line fitter is ANSI-aware and passes escape sequences through,
 * so anything arriving from a model or from config is cleaned at the boundary
 * that shows it.
 *
 * Known limits, stated rather than hidden:
 * - No control byte, `ESC` or C1 introducer ever survives: any leftover is
 *   dropped by the printable whitelist.
 * - The *bodies* of unterminated OSC, DCS (`ESC P`), APC/PM (`ESC _`, `ESC ^`)
 *   and 8-bit C1 OSC/PM/APC do survive as printable text. Cosmetic only: an
 *   advisory carries no verdict, so the rest of an abandoned sequence is ugly,
 *   not dangerous.
 * - `ESC` + intermediates + final byte can over-consume up to four characters
 *   after a lone `ESC` (`a<ESC>   text` → `aext`). Accepted: a lone `ESC` is
 *   malformed input from a model, and losing a few characters of advisory text
 *   cannot change a decision.
 */

export const ESC = "\u001b";
export const BEL = "\u0007";
const C1_CSI = "\u009b";

/**
 * ANSI escape sequences, matched whole: CSI (`ESC [` … final byte `@`-`~`),
 * OSC (`ESC ]` … BEL or ST), the legacy `ESC` + intermediates + final-byte
 * forms (two or three bytes, e.g. `ESC ( B`), and 8-bit C1 CSI. A fallback
 * that consumed one character per `ESC` would truncate those and leave the
 * rest as ordinary text — worse than not sanitizing, because it then reads as
 * sanitized. Matching the legacy form also lets a doubled introducer clean up:
 * the second `ESC` starts the match.
 */
export const ESCAPE_SEQUENCES = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[ -/]*[0-~])|${C1_CSI}[0-?]*[ -/]*[@-~]`,
  "g",
);

/** One line, so a line break inside untrusted text becomes a single space. */
export const LINE_BREAKS = /[\r\n\u2028\u2029]+/g;

/**
 * Everything that is not printable text or a space separator. A whitelist on
 * purpose: once whole sequences are gone, it drops every C0/C1 control (BEL,
 * DEL, a stray introducer), every format character (bidi overrides and
 * isolates) and any other separator, without enumerating them one by one.
 *
 * U+200D (ZWJ) is `Cf`, so compound emoji degrade to their components. That is
 * accepted: an annotation is plain advisory text.
 */
export const NON_PRINTABLE_CHARACTERS = /[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu;

/**
 * One line of annotation text, or `""` when nothing printable is left.
 *
 * Non-printables are dropped rather than spaced, so a stripped sequence leaves
 * no gap; tabs and line breaks collapse to a space so words stay separated.
 */
export function sanitizeAnnotationText(text: string): string {
  return text
    .replaceAll("\t", " ")
    .replace(LINE_BREAKS, " ")
    .replace(ESCAPE_SEQUENCES, "")
    .replace(NON_PRINTABLE_CHARACTERS, "")
    .trim();
}

/**
 * One annotator name as a label: printable, one line, capped at `max`
 * characters with an ellipsis.
 *
 * Non-printables become spaces here because a name is displayed as a label:
 * deleting `ev\nname` would silently join two names into a third.
 */
export function annotationSourceLabel(source: string, max: number): string {
  const printable = source
    .replace(ESCAPE_SEQUENCES, "")
    // Before the whitelist, so a CRLF collapses to one space, not two.
    .replace(LINE_BREAKS, " ")
    .replace(NON_PRINTABLE_CHARACTERS, " ")
    .trim();
  // Code points, not UTF-16 units: slicing mid-surrogate would render a
  // replacement glyph in place of the ellipsis.
  const points = Array.from(printable);
  return points.length <= max
    ? printable
    : `${points.slice(0, max).join("")}\u2026`;
}
