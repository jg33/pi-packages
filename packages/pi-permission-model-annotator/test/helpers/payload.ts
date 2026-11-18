import type { PromptPayload } from "@gotgenes/pi-permission-system";

/** A gate-shaped payload with every fact filled, overridable per test. */
export function makePayload(
  request: Partial<PromptPayload["request"]> = {},
  rest: Partial<PromptPayload> = {},
): PromptPayload {
  return {
    kind: "bash",
    request: {
      requester: { agentName: null, forwarded: false, sessionId: null },
      surface: "bash",
      toolName: "bash",
      invokedToolName: null,
      value: "npm run build",
      matchedPattern: "npm *",
      matchedSpelling: null,
      commandContext: null,
      executedUnit: null,
      decidingPath: null,
      ...request,
    },
    evidence: [{ label: "command", text: "npm run build", detail: null }],
    annotations: [],
    ...rest,
  };
}

/**
 * The payload with a jev verdict in its authorizer trail. `details` is passed
 * through verbatim, so a test can omit the weights exactly as an older
 * pi-jev-auto-mode does.
 */
export function withJevVerdict(
  details: Record<string, unknown>,
  payload: PromptPayload = makePayload(),
): PromptPayload {
  return {
    ...payload,
    authorizerContext: [{ event: "jev_authorizer_verdict", details }],
  } as PromptPayload;
}
