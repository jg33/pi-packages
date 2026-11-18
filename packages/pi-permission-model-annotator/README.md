# @gotgenes/pi-permission-model-annotator

A [Pi](https://github.com/earendil-works/pi) extension that writes a short, model-generated explanation into permission prompts: what the pending call does, what it touches, and — when `pi-jev-auto-mode` already judged the ask — the weights behind that verdict.

It is a consumer of [`@gotgenes/pi-permission-system`](../pi-permission-system/)'s prompt-annotator seam (ADR 0011 §8): it registers one annotator, `"model-summary"`, and the operator activates it by naming that name in `annotatorChain`.

The text is advisory by construction. An annotation cannot allow, deny, defer, or suppress an ask; it is rendered under a `model-generated (model-summary)` label below the evidence, and it never reaches the agent, the review log's decision fields, or the `permissions:ui_prompt` broadcast.

## Why

A permission prompt states the facts — the command, the matched rule, the surface — but not what the call is *for*. That is the gap an operator feels when a plausible-looking command stops for approval: the facts are all there and the intent is not.

This extension makes one small model call per ask to close that gap, and shows the jev auto-mode ranking beside it when the chain already computed one. It explains; it never decides.

## How it works

1. The prompt is about to be shown on this node (the node serving the ask, per ADR 0007 §7).
2. If `model-summary` is named in `annotatorChain` and this package has a config, the annotator renders the ask's facts and asks a light model for one or two sentences.
3. The answer is trimmed, length-bounded, and returned as the annotation. When the ask's authorizer trail carries a `jev_authorizer_verdict` with weights, the line is appended: `… — jev allowed via engine: p=0.93 (t=0.80)`.
4. If there is no verdict, no weights, no model, no auth, a timeout, a throw, or an empty reply, the prompt is shown as it would have been without the package — with the reason recorded in the review log.

The weights are read, never derived: `probabilities`, `thresholds`, `conditions`, and `decidingRule` come from the jev review entry only when the jev extension forwards them. A missing weight stays missing; nothing is estimated or defaulted.

## Configuration

`~/.pi/agent/extensions/pi-permission-model-annotator/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "timeoutMs": 4000,
  "maxCharacters": 220,
  "includeJevWeights": true
}
```

| Key                 | Default        | Meaning                                                                 |
| ------------------- | -------------- | ----------------------------------------------------------------------- |
| `provider`          | — (required)   | Model provider id passed to the session model registry.                 |
| `model`             | — (required)   | Model id within that provider.                                          |
| `instructions`      | built-in       | System prompt; the default asks for a description, never a verdict.     |
| `timeoutMs`         | `4000`         | This package's own ceiling on the call.                                 |
| `maxCharacters`     | `220`          | Rendered length cap (max `500`) — the prompt row budget elides anyway.  |
| `includeJevWeights` | `true`         | Append the jev weights when the trail carries them.                     |

The project layer (`.pi/extensions/pi-permission-model-annotator/config.json`) is read only for a trusted project; an untrusted project's file is ignored and reported once through a Pi notification. See [`docs/configuration.md`](./docs/configuration.md) for the full reference.

Activation is separate from installation:

```jsonc
// ~/.pi/agent/extensions/pi-permission-system/config.json
{
  "annotatorChain": ["model-summary"]
}
```

Installing the package shows nothing. The annotator runs only when the operator names it, so a stale or unwanted annotator is one config edit away from silence.

## What it records

One `model_annotator.decision` entry per ask it handles, in pi-permission-system's review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`), so "did it run, did it reach the model, what weights came back, why did it fall back" is answerable:

| Field         | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `requestId`   | Joins to the `permission_request.*` entries for the same ask.                                  |
| `status`      | `annotated` or `fallback`.                                                                    |
| `reason`      | On a fallback: `model-unresolved`, `auth-failed`, `timeout`, `call-failed`, or `empty-reply`. |
| `modelCalled` | `false` when no call was made (no model, no auth).                                            |
| `latencyMs`   | Call latency, or `null` when no call was made.                                                |
| `api`         | The provider API the call was addressed to.                                                   |
| `weights`     | The jev weights read from the trail, or `null`.                                               |
| `weightsShown`| The rendered weights fragment, or `null`.                                                     |
| `textLength`  | Length of the annotation shown, or `null` on a bare fallback. The text itself is not logged.  |

## Requirements and limits

- Requires a `@gotgenes/pi-permission-system` build that ships the prompt-annotator seam. On an older build the extension warns once and registers nothing.
- Requires a host session that publishes the permissions service; without it, the extension warns once.
- The real latency bound is `annotatorTimeoutMs` in pi-permission-system (default `1500` ms), not this package's `timeoutMs`; raise the former if you want to give summaries more room.
- Annotation text is a claim, not a fact. It is labelled as model-generated and must never be read as the reason the prompt appeared — the gate's evidence is.
