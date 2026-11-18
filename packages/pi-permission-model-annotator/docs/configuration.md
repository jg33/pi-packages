# Configuration

All configuration lives in `config.json` files. Two scopes are read, global then project, with the project layer overriding the global one field by field:

| Scope  | Path                                                              | Read when                        |
| ------ | ----------------------------------------------------------------- | -------------------------------- |
| Global | `<agentDir>/extensions/pi-permission-model-annotator/config.json` | always                           |
| Project| `<cwd>/.pi/extensions/pi-permission-model-annotator/config.json`  | the project is trusted           |

`<agentDir>` is Pi's agent directory (`~/.pi/agent` by default, honoring `PI_CODING_AGENT_DIR`).

An untrusted project's file is never read; its presence is reported once per session through a Pi notification, so the global-only scope is never silent.

A missing file is not an error: it means "no config", and the extension registers nothing. A malformed or invalid file is skipped with an issue reported through a Pi notification; the extension registers nothing rather than guessing at a half-valid config.

## Keys

### `provider` (required)

Provider id, as the session model registry knows it (`anthropic`, `openai`, …).

### `model` (required)

Model id within that provider, for example `claude-haiku-4-5`. The model is resolved from the session's model registry, so any model the session can address is usable.

### `instructions`

System prompt for the summary call. The default asks for one or two sentences on what the call does and what it touches, forbids a recommendation, and forbids inventing facts.

Change it to match your team's vocabulary, not to change the contract: an annotation is advisory text and nothing here can decide an ask.

### `timeoutMs`

Default `4000`. This package's own ceiling on one model call.

The effective bound is usually pi-permission-system's `annotatorTimeoutMs` (default `1500`), which bounds the whole annotator chain and aborts the call from outside. Raise that setting if you want summaries to have more time; this one exists so a hung provider cannot outlive a generous chain deadline.

### `maxCharacters`

Default `220`, maximum `500`. The rendered annotation is cut to this length with an ellipsis.

The prompt's row budget elides annotations first anyway, so a very long summary costs nothing but a wasted model answer.

### `includeJevWeights`

Default `true`. When the ask's authorizer trail carries a `jev_authorizer_verdict` entry with weights, the annotation appends them: `… — jev allowed via engine: p=0.93 (t=0.80)`.

Set it to `false` to show the prose alone. Absence of weights always means prose alone, whatever this is set to.

## Activation

This package registers the annotator whether or not it runs. Activation is pi-permission-system's `annotatorChain`:

```json
{
  "annotatorChain": ["model-summary"]
}
```

Order matters only when several annotators are configured. An unregistered name is skipped fail-safe by pi-permission-system, so a typo degrades to an unannotated prompt.

## Review-log events

One `model_annotator.decision` entry per handled ask, written through the annotator audit seam to the same review log as the gate's decisions. See the [README](../README.md#what-it-records) for the field table.
