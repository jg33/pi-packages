/**
 * Prove an annotator cannot decide an ask (ADR 0011 §8).
 *
 * This file tests the claim, not the implementation: it tries to make an
 * annotator allow, deny, defer or suppress, and asserts the run is
 * decision-identical to a run with no annotator configured. Only the rendering
 * may differ.
 *
 * The type half rides on `tsc` (`@ts-expect-error` and `expectTypeOf` are
 * checked by `pnpm run check`, which includes `test`).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { AskDialogQueue } from "#src/authority/ask-dialog-queue";
import type { AuthorizerVerdict } from "#src/authority/authorizer";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import {
  AnnotationRunner,
  type PayloadAnnotator,
} from "#src/presentation/annotation-runner";
import {
  type Annotator,
  type AnnotatorInput,
  AnnotatorRegistry,
} from "#src/presentation/annotator-registry";
import { renderPromptDialog } from "#src/presentation/dialog-renderer";
import {
  isRenderablePayload,
  modelGeneratedAnnotation,
  type PromptAnnotation,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import {
  hangingAnnotator,
  makeAnnotationLog,
  throwingAnnotator,
  verdictLikeAnnotator,
} from "#test/helpers/annotator-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";
import { makePromptPreferences } from "#test/helpers/prompt-view-fixtures";

describe("an annotator has no verdict in its types", () => {
  it("answers with text or nothing, never an AuthorizerVerdict", () => {
    expectTypeOf<Awaited<ReturnType<Annotator>>>().toEqualTypeOf<
      string | undefined
    >();

    // One line each: `@ts-expect-error` covers only the next line.
    const verdict: AuthorizerVerdict = { kind: "deny", reason: "no" };
    // @ts-expect-error -- a verdict is not an annotation answer
    const asAnnotator: Annotator = () => verdict;
    // @ts-expect-error -- nor is the same verdict, asynchronously
    const asAsync: Annotator = async () => verdict;
    expect([asAnnotator, asAsync]).toHaveLength(2);
  });

  it("hands an annotator no decision callback and no authority state", () => {
    expectTypeOf<keyof AnnotatorInput>().toEqualTypeOf<"payload" | "signal">();

    const input = {} as AnnotatorInput;
    // @ts-expect-error -- nothing to call to rule on the ask
    expect(input.decide).toBeUndefined();
    // @ts-expect-error -- no verdict lives on the input
    expect(input.verdict).toBeUndefined();
    // @ts-expect-error -- no authorizer to reach for
    expect(input.authorize).toBeUndefined();
    // @ts-expect-error -- the payload is read-only, not swappable authority
    input.payload = {} as PromptPayload;
    // @ts-expect-error -- so is the signal
    input.signal = new AbortController().signal;
  });

  it("can only yield a payload from the annotation path", () => {
    expectTypeOf<ReturnType<PayloadAnnotator["annotate"]>>().toEqualTypeOf<
      Promise<PromptPayload>
    >();
  });

  it("gives an annotation no field a verdict could ride on", () => {
    expectTypeOf<keyof PromptAnnotation>().toEqualTypeOf<
      "source" | "text" | "marking"
    >();

    const annotation = modelGeneratedAnnotation("echo", "hi");
    // @ts-expect-error -- structurally, an annotation is not a verdict
    const asVerdict: AuthorizerVerdict = annotation;
    expect(asVerdict).toBeDefined();
  });
});

describe("an annotator cannot change the decision or suppress the prompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const DENIED: PermissionPromptDecision = {
    approved: false,
    state: "denied",
    decidedBy: DECIDED_BY_HUMAN,
  };

  /** Run one ask; `undefined` means the default, empty chain. */
  async function run(annotator?: Annotator) {
    const registry = new AnnotatorRegistry();
    const chain = annotator ? ["judge"] : [];
    if (annotator) registry.register("judge", annotator);
    const decide = vi
      .fn<typeof requestPermissionDecision>()
      .mockResolvedValue(DENIED);
    const details = makePromptDetails();
    const events = {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => undefined),
    };
    const authorizer = new LocalUserAuthorizer({
      ui: {
        select: vi.fn(),
        input: vi.fn(),
        custom: vi.fn(),
        getToolsExpanded: vi.fn(() => false),
        setToolsExpanded: vi.fn(),
      },
      mode: "tui",
      events,
      dialogs: new AskDialogQueue(),
      getPromptPreferences: () => makePromptPreferences(),
      requestPermissionDecision: decide,
      describeSession: () => ({ name: "s", cwd: "/w" }),
      getAnnotatorTimeoutMs: () => 1000,
      annotator: new AnnotationRunner({
        registry,
        getChain: () => chain,
        getTimeoutMs: () => 1000,
        log: makeAnnotationLog(),
      }),
    });

    const pending = authorizer.authorize(details);
    await vi.advanceTimersByTimeAsync(1000);
    const decision = await pending;
    const shown: PromptPayload | undefined = decide.mock.calls[0]?.[2];
    return { decision, decide, details, events, shown };
  }

  /** The payload the dialog was handed; fails the test if no prompt appeared. */
  function shownPayload(payload: PromptPayload | undefined): PromptPayload {
    if (payload === undefined) throw new Error("no prompt was shown");
    return payload;
  }

  function annotationsOf(
    payload: PromptPayload | undefined,
  ): readonly PromptAnnotation[] {
    return payload === undefined ? [] : payload.annotations;
  }

  /** The fact rows only: the annotation region is the one thing that may differ. */
  function factLines(payload: PromptPayload | undefined): readonly string[] {
    return renderedSuffix(payload).filter(
      (line) => !line.startsWith("model-generated ("),
    );
  }

  function renderedSuffix(
    payload: PromptPayload | undefined,
  ): readonly string[] {
    if (payload === undefined) return [];
    return renderPromptDialog(payload, {
      ...makePromptPreferences().budget,
      width: 120,
    }).lines;
  }

  const baseline = {
    decision: DENIED,
  };

  it.each([
    ["returns a verdict-shaped object", verdictLikeAnnotator],
    ["throws", throwingAnnotator],
    ["never answers", hangingAnnotator],
  ])(
    "the human's decision stands when an annotator %s",
    async (_label, annotator) => {
      const { decision, decide } = await run(annotator);

      // The prompt was shown exactly once (not suppressed), and what the
      // authorizer returned is what the human's surface returned.
      expect(decision).toBe(DENIED);
      expect(decision).toEqual(baseline.decision);
      expect(decide).toHaveBeenCalledTimes(1);
    },
  );

  it("cannot smuggle an AuthorizerVerdict through the annotation text", async () => {
    const verdict = { kind: "allow" } as unknown as string;
    const { decision, shown, decide } = await run(() => verdict);

    expect(decision).toBe(DENIED);
    expect(decide).toHaveBeenCalledTimes(1);
    // A non-string answer is dropped, so the prompt renders as it does with no
    // annotator at all — not as a claim that it was allowed.
    expect(annotationsOf(shown)).toEqual([]);
  });

  /** An untyped annotator that edits the facts it was handed. */
  function mutator(mutate: (payload: PromptPayload) => void): Annotator {
    return ({ payload }) => {
      mutate(payload);
      return "an annotation";
    };
  }

  it("cannot rewrite the runtime facts the dialog shows", async () => {
    const clean = await run();
    const annotated = await run(
      mutator((payload) => {
        (payload.request as unknown as { value: string }).value =
          "echo MUTATED";
      }),
    );

    expect(factLines(annotated.shown)).toEqual(factLines(clean.shown));
    expect(JSON.stringify(renderedSuffix(annotated.shown))).not.toContain(
      "MUTATED",
    );
    expect(annotated.decision).toBe(DENIED);
    expect(annotated.decision).toEqual(clean.decision);
  });

  it("cannot rewrite toolName or the evidence", async () => {
    const clean = await run();
    const annotated = await run(
      mutator((payload) => {
        (payload.request as unknown as { toolName: string | null }).toolName =
          "rm";
        (payload.evidence as unknown as unknown[]).push({
          label: "injected",
          text: "from the annotator",
          detail: null,
        });
      }),
    );

    const shown = shownPayload(annotated.shown);
    expect(shown.request.toolName).toBe("read");
    expect(shown.evidence).toEqual([]);
    expect(factLines(annotated.shown)).toEqual(factLines(clean.shown));
    expect(annotated.decision).toBe(DENIED);
  });

  it("does not lose or block the ask when the annotator tries to mutate", async () => {
    const annotated = await run(
      mutator((payload) => {
        (payload.request as unknown as { value: string }).value = "MUTATED";
        (payload.evidence as unknown as unknown[]).push({
          label: "x",
          text: "y",
          detail: null,
        });
      }),
    );

    expect(annotated.decide).toHaveBeenCalledTimes(1);
    expect(annotated.decision).toBe(DENIED);
  });

  it("still contributes an annotation that passes isRenderablePayload", async () => {
    const annotated = await run(() => "a note");

    expect(annotationsOf(annotated.shown)).toEqual([
      modelGeneratedAnnotation("judge", "a note"),
    ]);
    // Composition identity holds: the shown payload is built from the gate's
    // own `request`/`evidence`, not from the annotator's copy.
    const shown = shownPayload(annotated.shown);
    expect(isRenderablePayload(shown, annotated.details.payload)).toBe(true);
    expect(shown.request).toBe(annotated.details.payload.request);
    expect(shown.evidence).toBe(annotated.details.payload.evidence);
  });

  it("keeps the broadcast free of annotations and of annotator edits", async () => {
    const clean = await run();
    const annotated = await run(
      mutator((payload) => {
        (payload.request as unknown as { value: string }).value = "MUTATED";
      }),
    );

    expect(JSON.stringify(annotated.events.emit.mock.calls)).not.toContain(
      "an annotation",
    );
    expect(JSON.stringify(annotated.events.emit.mock.calls)).not.toContain(
      "MUTATED",
    );
    // The broadcast carries the same facts as a run with no annotator.
    expect(JSON.stringify(annotated.events.emit.mock.calls)).toEqual(
      JSON.stringify(clean.events.emit.mock.calls),
    );
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "  \n\t "],
    ["undefined", undefined],
  ])(
    "does not suppress the prompt when it answers %s",
    async (_label, answer) => {
      const clean = await run();
      const { decision, decide, shown } = await run(() => answer);

      expect(decide).toHaveBeenCalledTimes(1);
      expect(decision).toBe(DENIED);
      // The blank-annotation drop: the prompt is shown, unannotated, and it
      // renders exactly as it does with no annotator configured.
      expect(annotationsOf(shown)).toEqual([]);
      expect(renderedSuffix(shown)).toEqual(renderedSuffix(clean.shown));
    },
  );

  it("cannot gain authority by mutating its input", async () => {
    const mutatingInput: Annotator = (input) => {
      // Readonly at the type level; an untyped caller can still try.
      const mutable = input as unknown as {
        payload: PromptPayload;
        signal: AbortSignal;
        verdict?: unknown;
        decide?: unknown;
      };
      mutable.verdict = { kind: "allow" };
      mutable.decide = () => ({ kind: "allow" });
      return "an annotation";
    };
    const { decision, decide } = await run(mutatingInput);

    expect(decision).toBe(DENIED);
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
