/**
 * The built-in `pending-command` annotator (asks-parity plan item 5).
 *
 * Registration shape — exactly one annotator, under the name the operator
 * puts in `annotatorChain` — and the advisory text it answers with: what the
 * ask would run, why the prompt exists, and the jev-auto-mode verdict the
 * chain already wrote for this ask when the captured trail carried one
 * (D4: read from the existing authorizer result, no new model call).
 */
import { describe, expect, it } from "vitest";
import type {
  Annotator,
  AnnotatorInput,
} from "#src/presentation/annotator-registry";
import { registerPendingCommandAnnotator } from "#src/presentation/pending-command-annotator";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** Run the registration once and keep what it offered. */
function registeredAnnotators(): Array<{ name: string; annotator: Annotator }> {
  const registered: Array<{ name: string; annotator: Annotator }> = [];
  registerPendingCommandAnnotator({
    registerAnnotator: (name, annotator) => {
      registered.push({ name, annotator });
      return () => undefined;
    },
  });
  return registered;
}

/** A gate payload with the given request facts and optional context. */
function askWith(
  facts: Partial<PromptPayload["request"]>,
  rest: Partial<PromptPayload> = {},
): PromptPayload {
  const base = makePromptPayload();
  return { ...base, request: { ...base.request, ...facts }, ...rest };
}

async function answer(payload: PromptPayload): Promise<string | undefined> {
  const [only] = registeredAnnotators();
  const input: AnnotatorInput = {
    payload,
    signal: new AbortController().signal,
    requestId: "req-test",
    log: { review: () => undefined },
  };
  return await only.annotator(input);
}

describe("registerPendingCommandAnnotator", () => {
  it("registers exactly one annotator under the pending-command name", () => {
    const registered = registeredAnnotators();

    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("pending-command");
    expect(typeof registered[0].annotator).toBe("function");
  });
});

describe("the pending-command annotator's answer", () => {
  it("explains what the ask would run and why the prompt exists", async () => {
    const text = await answer(
      askWith({
        value: "rm -rf build",
        toolName: "bash",
        surface: "bash",
        matchedPattern: "rm -rf*",
      }),
    );

    expect(text).toBeDefined();
    expect(text).toContain("rm -rf build");
    expect(text).toContain("bash");
    expect(text).toContain("rm -rf*");
  });

  it("omits the rule clause when no rule matched", async () => {
    const text = await answer(
      askWith({ value: "/etc/hosts", matchedPattern: null }),
    );

    expect(text).toBeDefined();
    expect(text).toContain("/etc/hosts");
    expect(text).not.toContain('rule "');
  });

  it("surfaces the jev-auto-mode verdict from this ask's authorizer context", async () => {
    const text = await answer(
      askWith(
        { value: "git push", matchedPattern: null },
        {
          authorizerContext: [
            {
              event: "jev_authorizer_verdict",
              details: {
                requestId: "req-1",
                tool: "bash",
                status: "deferred",
                source: "uncertain",
                rationale: "No condition was violated.",
              },
            },
          ],
        },
      ),
    );

    expect(text).toBeDefined();
    expect(text).toContain("jev-auto-mode");
    expect(text).toContain("deferred via uncertain");
    expect(text).toContain("No condition was violated.");
  });

  it("reads only the verdict entry, not the rest of the trail", async () => {
    const text = await answer(
      askWith(
        { value: "git push", matchedPattern: null },
        {
          authorizerContext: [
            { event: "some_other_link_event", details: { note: "kept" } },
          ],
        },
      ),
    );

    expect(text).toBeDefined();
    expect(text).not.toContain("jev-auto-mode");
    expect(text).not.toContain("some_other_link_event");
  });

  it("answers nothing when there is nothing to explain", async () => {
    const text = await answer(askWith({ value: "", matchedPattern: null }));

    expect(text).toBeUndefined();
  });
});
