import type { ForwardedPermissionRequest } from "#src/authority/permission-forwarding";
import type { PromptPayload, PromptRequester } from "./prompt-payload";

/**
 * Build the payload for an ask forwarded up from a subagent.
 *
 * A projection, not a synthesizer: the child ships its own complete payload, so
 * the serving node renders the child's facts under the *parent's* budget — which
 * is what makes a forwarded ask and a local one consistent in kind, a forwarded
 * bash ask reading `command : …` exactly as a local one does (ADR 0011 §2).
 *
 * A request carrying no payload renders from whatever it does hold: fail-closed
 * applies to presentation as it does to policy, so a version-skewed ask still
 * reaches the human rather than resolving without one (ADR 0011 §9).
 *
 * This is the read boundary, and the serving node is the trust boundary: the
 * child's `annotations` slot is discarded unread, whatever the child filled in.
 * A child that blanks its own slot is cooperative defence only; a hostile child
 * could label its own text `model-generated (trusted-judge)`, so the serving
 * node authors the slot itself (#654, ADR 0011 §8).
 */
export function buildForwardedAskPayload(
  request: ForwardedPermissionRequest,
): PromptPayload {
  // The child built its payload with `localRequester` — `forwarded: false`,
  // `sessionId: null`. The serving node is the only party that knows the ask
  // arrived over the wire, and the request's own provenance is authoritative
  // (#292); every other fact is the child's and passes through untouched —
  // except the annotations slot, which this node owns (see above).
  const requester: PromptRequester = {
    agentName: request.requesterAgentName,
    forwarded: true,
    sessionId: request.requesterSessionId,
  };

  return request.payload
    ? {
        ...request.payload,
        request: { ...request.payload.request, requester },
        // Discarded on read, not trusted from the wire: only an annotator
        // registered on this node may write here, via `AnnotationRunner`.
        annotations: [],
      }
    : degradedForwardedPayload(request, requester);
}

/**
 * The render for an ask that arrived without a payload.
 *
 * `kind: "forwarded"` narrows to meaning exactly this — not "an ask from a
 * subagent", which every branch above is too.
 */
function degradedForwardedPayload(
  request: ForwardedPermissionRequest,
  requester: PromptRequester,
): PromptPayload {
  return {
    kind: "forwarded",
    request: {
      requester,
      // The child's display projection: what the ask was about, as the child's
      // own gate named it.
      surface: request.surface ?? "",
      toolName: null,
      invokedToolName: null,
      value: request.value ?? "",
      matchedPattern: null,
      commandContext: null,
      matchedSpelling: null,
      executedUnit: null,
      decidingPath: null,
    },
    // Nothing to carry: the wire no longer relays a sentence, and inventing
    // evidence the child never sent is exactly the fiction the bounded
    // renderers would then have to trust.
    evidence: [],
    annotations: [],
  };
}
