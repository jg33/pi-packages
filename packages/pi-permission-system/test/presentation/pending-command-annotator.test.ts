/**
 * The built-in annotators (asks-parity plan item 5).
 *
 * Registration shape — two names, each the operator's opt-in in
 * `annotatorChain` — and the advisory text each answers with: the
 * `pending-command` annotator says what the ask would run and why the prompt
 * exists; the `jev-verdict` annotator says what the authorizer chain already
 * decided for this ask (D4: read from the existing authorizer result, no new
 * model call). They are separate rows because they answer different questions
 * (#PPB-10).
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

/** The annotator registered under `name`. */
function annotatorNamed(name: string): Annotator {
  const found = registeredAnnotators().find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`no annotator registered as ${name}`);
  }
  return found.annotator;
}

/** A gate payload with the given request facts and optional context. */
function askWith(
  facts: Partial<PromptPayload["request"]>,
  rest: Partial<PromptPayload> = {},
): PromptPayload {
  const base = makePromptPayload();
  return { ...base, request: { ...base.request, ...facts }, ...rest };
}

async function answer(
  name: string,
  payload: PromptPayload,
): Promise<string | undefined> {
  const input: AnnotatorInput = {
    payload,
    signal: new AbortController().signal,
    requestId: "req-test",
    log: { review: () => undefined },
  };
  return await annotatorNamed(name)(input);
}

describe("registerPendingCommandAnnotator", () => {
  it("registers the two built-ins under the names the operator names", () => {
    const registered = registeredAnnotators();

    expect(registered.map((entry) => entry.name)).toEqual([
      "pending-command",
      "jev-verdict",
    ]);
    for (const entry of registered) {
      expect(typeof entry.annotator).toBe("function");
    }
  });
});

describe("the pending-command annotator's answer", () => {
  it("explains what the ask would run and why the prompt exists", async () => {
    const text = await answer(
      "pending-command",
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
      "pending-command",
      askWith({ value: "/etc/hosts", matchedPattern: null }),
    );

    expect(text).toBeDefined();
    expect(text).toContain("/etc/hosts");
    expect(text).not.toContain('rule "');
  });

  it("leaves the chain's verdict to the jev-verdict annotator", async () => {
    const text = await answer(
      "pending-command",
      askWith(
        { value: "git push", matchedPattern: null },
        {
          authorizerContext: [
            {
              event: "jev_authorizer_verdict",
              details: {
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
    expect(text).not.toContain("deferred via uncertain");
    expect(text).not.toContain("No condition was violated.");
  });

  it("answers nothing when there is nothing to explain", async () => {
    const text = await answer(
      "pending-command",
      askWith({ value: "", matchedPattern: null }),
    );

    expect(text).toBeUndefined();
  });
});

describe("the jev-verdict annotator's answer", () => {
  it("states the verdict the chain already wrote for this ask", async () => {
    const text = await answer(
      "jev-verdict",
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

    expect(text).toBe("deferred via uncertain — No condition was violated.");
  });

  it("reads only the verdict entry, not the rest of the trail", async () => {
    const text = await answer(
      "jev-verdict",
      askWith(
        { value: "git push", matchedPattern: null },
        {
          authorizerContext: [
            { event: "some_other_link_event", details: { note: "kept" } },
          ],
        },
      ),
    );

    expect(text).toBeUndefined();
  });

  it("answers nothing when the trail is absent", async () => {
    expect(
      await answer("jev-verdict", askWith({ value: "git push" })),
    ).toBeUndefined();
  });

  it("answers nothing when the verdict carries no words", async () => {
    const text = await answer(
      "jev-verdict",
      askWith(
        { value: "git push" },
        {
          authorizerContext: [{ event: "jev_authorizer_verdict", details: {} }],
        },
      ),
    );

    expect(text).toBeUndefined();
  });
});
