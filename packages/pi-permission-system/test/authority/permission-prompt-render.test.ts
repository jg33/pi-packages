import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  bashPayload,
  fakeTheme,
  KEY,
  mountPrompt,
  strip,
} from "./helpers/prompt-harness";

const NOW = { doublePressToConfirm: false } as const;
const border = (w: number) => fakeTheme.fg("accent", "─".repeat(w));
const flat = (lines: readonly string[]) =>
  strip(lines.join(" ")).replace(/\s+/g, " ");

describe("decision step — ask_user visual language", () => {
  it("is framed by accent borders and a header chip", () => {
    const lines = mountPrompt({ view: NOW }).render(120);
    expect(lines[0]).toBe(border(120));
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(
      ` ${fakeTheme.bg("selectedBg", " Permission Required ")}`,
    );
    expect(lines[3]).toBe("");
    expect(lines.at(-3)).toBe(border(120));
    expect(lines.at(-2)).toBe("");
  });

  it("uses the subagent title for a forwarded ask", () => {
    const lines = mountPrompt({
      view: NOW,
      title: "Permission Required (Subagent)",
    }).render(120);
    expect(lines[2]).toContain("Permission Required (Subagent)");
  });

  it("marks the highlighted option with ❯ + its ordinal in accent+bold and indents the rest", () => {
    const lines = mountPrompt({ view: NOW }).render(120);
    expect(lines).toContain(
      fakeTheme.fg("accent", fakeTheme.bold("❯ 1. allow")),
    );
    expect(lines).toContain("  2. allow for all agents");
    expect(lines).toContain("  3. deny");
    expect(strip(lines.join("\n"))).not.toContain("▶");
    expect(strip(lines.join("\n"))).not.toContain("(y)");
  });

  it("↓ moves the ❯", () => {
    const m = mountPrompt({ view: NOW });
    m.type(KEY.down);
    expect(m.render(120)).toContain(
      fakeTheme.fg("accent", fakeTheme.bold("❯ 2. allow for all agents")),
    );
  });

  it("numbers the all-agents row from the option list", () => {
    expect(flat(mountPrompt({ view: NOW }).render(120))).not.toContain(
      "allow for this agent",
    );
    const lines = mountPrompt({
      view: NOW,
      options: { forwarded: true, sessionScope: true },
    }).render(120);
    expect(lines).toContain("  3. allow for all agents");
    expect(lines).toContain("  4. deny");
  });

  it("numbers rows by position, ignoring the configured key column", () => {
    const dialogKeys = {
      approve: "a",
      approveSession: "c",
      approveSessionBoth: "d",
      deny: "e",
      denyWithReason: "f",
    };
    const lines = mountPrompt({ view: { ...NOW, dialogKeys } }).render(120);
    expect(lines).toContain(
      fakeTheme.fg("accent", fakeTheme.bold("❯ 1. allow")),
    );
    // Rows are numbered by position, not by the remapped character: on this
    // narrow ask deny sits third, because the scope row is absent.
    expect(lines).toContain("  3. deny");
  });

  it("hint: ask_user wording, dim, truthful about double-press", () => {
    const dim = (s: string) => ` ${fakeTheme.fg("dim", s)}`;
    expect(mountPrompt({ view: NOW }).render(120).at(-1)).toBe(
      dim(
        "Enter to select · ↑/↓ to navigate · Esc to deny · Press a key to choose",
      ),
    );
    expect(
      mountPrompt({ view: { doublePressToConfirm: true } })
        .render(120)
        .at(-1),
    ).toBe(
      dim(
        "Enter to select · ↑/↓ to navigate · Esc to deny · Press a key, then again to confirm",
      ),
    );
  });

  it("armed: the footer carries the confirm prompt in warning color", () => {
    const m = mountPrompt({ view: { doublePressToConfirm: true } });
    m.type("y");
    expect(m.render(120).at(-1)).toBe(
      ` ${fakeTheme.fg("warning", "Press y again to allow.")}`,
    );
  });

  it("the unanswered deadline is always visible, even on a narrow terminal", () => {
    const m = mountPrompt({ view: { promptTimeoutMs: 30_000 } });
    for (const width of [24, 40, 80]) {
      expect(flat(m.render(width))).toContain("denies in 30s");
    }
  });

  it("ctrl+o is advertised only when the render elided something", () => {
    expect(flat(mountPrompt({ view: NOW }).render(120))).not.toContain(
      "Ctrl+O",
    );
    const evidence = Array.from({ length: 60 }, (_, i) => ({
      label: `path ${i}`,
      text: `/p/${i}`,
      detail: null,
    }));
    const long = mountPrompt({
      view: NOW,
      payload: { ...bashPayload(), evidence },
    });
    expect(flat(long.render(120))).toContain("Ctrl+O for full request");
  });

  it("the expand key shows the complete request and never reaches the decision model", () => {
    const evidence = Array.from({ length: 60 }, (_, i) => ({
      label: `path ${i}`,
      text: `/p/${i}`,
      detail: null,
    }));
    const m = mountPrompt({
      view: NOW,
      expandKey: "\x0f",
      payload: { ...bashPayload(), evidence },
    });
    expect(flat(m.render(120))).not.toContain("/p/59");
    m.type("\x0f");
    expect(m.done).not.toHaveBeenCalled();
    expect(m.setToolsExpanded).toHaveBeenCalledTimes(1);
    const expanded = flat(m.render(120));
    expect(expanded).toContain("/p/59");
    expect(expanded).toContain("Ctrl+O to collapse");
    m.type("\x0f");
    expect(flat(m.render(120))).not.toContain("/p/59");
  });

  it("every row fits the terminal at any width", () => {
    const m = mountPrompt({
      view: { promptTimeoutMs: 30_000 },
      options: { forwarded: true, sessionScope: true },
    });
    for (const width of [12, 20, 40, 80, 200]) {
      for (const line of m.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("still mounts inline", () => {
    expect(mountPrompt().custom).toHaveBeenCalledWith(expect.any(Function), {
      overlay: false,
      blocked: { kind: "permission", message: "approve bash: rm -rf /tmp/x" },
    });
  });
});

describe("terminal-row-aware ask cap", () => {
  it("keeps the options and hint on screen when a long ask meets a short terminal", () => {
    const evidence = Array.from({ length: 40 }, (_, i) => ({
      label: `path ${i}`,
      text: `/very/long/path/${i}`,
      detail: null,
    }));
    const m = mountPrompt({
      view: NOW,
      rows: 30,
      payload: { ...bashPayload(), evidence },
    });
    const lines = m.render(100);
    expect(lines.length).toBeLessThanOrEqual(30);
    const text = flat(lines);
    expect(text).toContain("3. deny");
    expect(text).toContain("Enter to select");
    expect(text).toContain("Ctrl+O for full request");
  });

  it("leaves the expanded (Ctrl+O) view uncapped, so the complete request stays reachable", () => {
    const evidence = Array.from({ length: 40 }, (_, i) => ({
      label: `path ${i}`,
      text: `/very/long/path/${i}`,
      detail: null,
    }));
    const m = mountPrompt({
      view: NOW,
      rows: 30,
      expandKey: "\x0f",
      payload: { ...bashPayload(), evidence },
    });
    m.type("\x0f");
    expect(flat(m.render(100))).toContain("/very/long/path/39");
  });

  it("does not shrink the ask on a tall terminal", () => {
    const evidence = Array.from({ length: 40 }, (_, i) => ({
      label: `path ${i}`,
      text: `/p/${i}`,
      detail: null,
    }));
    const tall = mountPrompt({
      view: NOW,
      rows: 200,
      payload: { ...bashPayload(), evidence },
    }).render(100).length;
    const short = mountPrompt({
      view: NOW,
      rows: 30,
      payload: { ...bashPayload(), evidence },
    }).render(100).length;
    expect(tall).toBeGreaterThan(short);
  });
});

// The dialog's own rows: the frame must never emit more rows than the terminal
// has — the host paints a shrunken box from the top, so an over-tall frame
// loses its bottom rows (the numbered options) first.
describe("decision step row budget across terminal heights", () => {
  const evidence = Array.from({ length: 40 }, (_, i) => ({
    label: `path ${i}`,
    text: `/very/long/path/${i}`,
    detail: null,
  }));
  const HEIGHTS = [10, 12, 15, 16, 17, 18, 20, 24, 40] as const;

  it("emits all numbered option rows at every height (the herdr button contract)", () => {
    for (const rows of HEIGHTS) {
      const m = mountPrompt({
        view: NOW,
        rows,
        payload: { ...bashPayload(), evidence },
      });
      const numbers = m
        .render(80)
        .map(strip)
        .flatMap((line) => {
          const digit = HERDR_OPTION.exec(line)?.[2];
          return digit === undefined ? [] : [Number(digit)];
        });
      expect(numbers, `rows=${rows}`).toEqual([1, 2, 3]);
    }
  });

  it("emits at most `rows` lines whenever the frame can fit the terminal", () => {
    // 17 rows is the floor below which the dialog cannot fit on width 80
    // (9 frame rows + 3 core ask rows + 4 options, +1 when the elided hint
    // wraps); above it, fitting is the row budget's job — before the fix a
    // long ask emitted 20 rows at rows=15..18.
    for (const rows of [17, 18, 20, 24, 40]) {
      const m = mountPrompt({
        view: NOW,
        rows,
        payload: { ...bashPayload(), evidence },
      });
      const lines = m.render(80);
      expect(
        lines.length,
        `rows=${rows}, emitted=${lines.length}`,
      ).toBeLessThanOrEqual(rows);
    }
  });
});

// herdr's Asks panel scrapes the screen with exactly this pattern
// (~/.config/herdr-app/mods/tabs-asks/engine.js:58) and adopts the run as the
// APPROVAL card's clickable options. A row that stops matching is a missing button.
const HERDR_OPTION = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/;

describe("herdr Asks-panel scrape contract", () => {
  const wide = { forwarded: true, sessionScope: true };

  it("renders one scraper-matching row per visible action, numbered 1..n", () => {
    const cases = [
      { m: mountPrompt({ view: NOW }), expected: [1, 2, 3] },
      {
        m: mountPrompt({ view: NOW, options: wide }),
        expected: [1, 2, 3, 4],
      },
    ];
    for (const { m, expected } of cases) {
      for (const width of [40, 80, 120]) {
        const numbers = m.screen(width).flatMap((line) => {
          const digit = HERDR_OPTION.exec(line)?.[2];
          return digit === undefined ? [] : [Number(digit)];
        });
        expect(numbers).toEqual(expected);
      }
    }
  });
});
