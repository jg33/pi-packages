import { ScrollView, VStack } from "@earendil-works/pi-tui";
// The layout frame renderer pi's fullscreen (default, tuiMode: "fullscreen")
// paints with. Deep import because pi-tui has no exports map restricting it.
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { describe, expect, it } from "vitest";
import { bashPayload, mountPrompt, strip } from "./helpers/prompt-harness";

/**
 * Host-side paint test: pi's fullscreen layout docks the dialog in a shrinkable
 * box, and a box allocated fewer rows than the component emits is painted
 * from the top — the dialog's BOTTOM rows (the numbered options) are what the
 * terminal never sees. That is the reported symptom: question visible, choices
 * missing.
 *
 * The dock below mirrors `createChatViewport` in pi-coding-agent's
 * `modes/interactive/chat-viewport.js` (pinned devDependency, behind an
 * exports map so it cannot be imported directly):
 *
 *   root = VStack([transcript ScrollView (grow/shrink, min 1),
 *                  dock (basis auto, shrink, min 1)])
 *   dock = VStack([... editor (shrink 1, minSize 3) ...])
 */
const NOW = { doublePressToConfirm: false } as const;
const OPTION_ROW = /^\s*(❯\s*)?(\d{1,2})\.\s+\S/;

const EVIDENCE = Array.from({ length: 40 }, (_, i) => ({
  label: `path ${i}`,
  text: `/very/long/path/${i}`,
  detail: null,
}));

function paintedAt(rows: number, evidence: typeof EVIDENCE | undefined) {
  const m = mountPrompt({
    view: NOW,
    rows,
    payload: evidence ? { ...bashPayload(), evidence } : bashPayload(),
  });
  const editor = { render: (w: number) => m.component.render(w) };
  const document = {
    render: () => Array.from({ length: 120 }, (_, i) => `chat line ${i}`),
  };
  const empty = { render: () => [""] };
  const transcript = new ScrollView(document as never, {
    follow: "end",
    primary: true,
    overscroll: "chain",
  });
  const dock = new VStack([
    { component: empty as never, shrink: 1, minSize: 0 },
    { component: empty as never, shrink: 1, minSize: 0 },
    { component: empty as never, shrink: 1, minSize: 0 },
    { component: editor as never, shrink: 1, minSize: 3 },
    { component: empty as never, shrink: 1, minSize: 0 },
    { component: empty as never, shrink: 1, minSize: 0 },
  ]);
  const root = new VStack([
    {
      component: transcript,
      basis: 0,
      grow: 1,
      shrink: 1,
      minSize: 1,
    },
    {
      component: dock,
      basis: "auto" as const,
      grow: 0,
      shrink: 1,
      minSize: 1,
    },
  ]);
  const frame = renderLayoutFrame(root, 80, rows, () => {});
  return frame.lines.map(strip);
}

describe("fullscreen dock paint — the options must survive the clip", () => {
  // The heights where the emitted frame overran the terminal before the fix.
  // 15 is the floor this test pins: 16 emitted rows cannot fit a 15-row
  // terminal, but shrinking the ask body must make every height ≥ 15 paint
  // all four options.
  const HEIGHTS = [15, 16, 17, 18, 20, 24, 40] as const;

  it("paints every numbered option row (long ask)", () => {
    for (const rows of HEIGHTS) {
      const painted = paintedAt(rows, EVIDENCE);
      const numbers = painted.flatMap((line) => {
        const digit = OPTION_ROW.exec(line)?.[2];
        return digit === undefined ? [] : [Number(digit)];
      });
      expect(numbers, `rows=${rows}`).toEqual([1, 2, 3]);
    }
  });

  it("keeps the ask's decision-relevant facts above the options (short ask)", () => {
    for (const rows of HEIGHTS) {
      const painted = paintedAt(rows, undefined);
      expect(
        painted.some((line) => /\brequest\s*:/.test(line)),
        `rows=${rows}`,
      ).toBe(true);
    }
  });
});
