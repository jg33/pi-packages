import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Pure layout for the permission dialog, in the visual language of Pi's
 * `ask_user_question` dialog: accent borders, a header chip, a `❯` option list
 * and a dim hint footer. No decision logic lives here — the reducer owns that.
 *
 * Unlike ask_user's footer, the hint is never clipped to one line: it carries
 * the unanswered-deadline and armed-confirmation notices, which must not fall
 * off a narrow terminal. The component wraps it with `fitLinesToWidth`.
 */

/** The theme surface the layout paints with; structurally satisfied by Pi's theme. */
export interface ChromeTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

/** Columns the ask body and hint are indented, as ask_user's padded text rows are. */
export const BODY_INDENT = 1;

const ACTIVE_POINTER = "❯ ";
const INACTIVE_POINTER = "  ";

export interface OptionRow {
  /** The hotkey that selects this row; absent where no key selects it (scope step). */
  key?: string;
  label: string;
  selected: boolean;
}

export function borderRow(theme: ChromeTheme, width: number): string {
  return theme.fg("accent", "─".repeat(Math.max(0, width)));
}

export function indentRows(rows: readonly string[]): string[] {
  const pad = " ".repeat(BODY_INDENT);
  return rows.map((row) => (row === "" ? row : pad + row));
}

/** The full stack: border, spacer, header chip, spacer, body, spacer, border, spacer, hint. */
export function frame(
  theme: ChromeTheme,
  width: number,
  title: string,
  body: readonly string[],
  hint: string,
): string[] {
  return [
    borderRow(theme, width),
    "",
    ` ${theme.bg("selectedBg", ` ${title} `)}`,
    "",
    ...body,
    "",
    borderRow(theme, width),
    "",
    hint,
  ];
}

export function optionRows(
  theme: ChromeTheme,
  rows: readonly OptionRow[],
  width: number,
): string[] {
  return rows.flatMap((row) => {
    const pointer = row.selected ? ACTIVE_POINTER : INACTIVE_POINTER;
    const prefix = `${pointer}${row.key === undefined ? "" : `${row.key}. `}`;
    const continuation = " ".repeat(visibleWidth(prefix));
    const room = Math.max(1, width - visibleWidth(prefix));
    return wrapTextWithAnsi(row.label, room).map((segment, index) => {
      const line = `${index === 0 ? prefix : continuation}${segment}`;
      return row.selected ? theme.fg("accent", theme.bold(line)) : line;
    });
  });
}

export function hintRow(
  theme: ChromeTheme,
  parts: readonly string[],
  color: "dim" | "warning" = "dim",
): string {
  return `${" ".repeat(BODY_INDENT)}${theme.fg(color, parts.join(" · "))}`;
}
