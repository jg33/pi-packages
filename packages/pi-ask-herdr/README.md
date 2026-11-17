# pi-ask-herdr

> **Vendored, locally patched copy** of upstream `npm:pi-ask-herdr` v0.3.0.
> Diverges from upstream in: `src/herdr-status.ts` (new — builds the herdr
> Asks `blocked` message), `src/ui.ts` (passes the `blocked` option to
> `ctx.ui.custom`, digit-key option picking), `src/tool.ts` (old terminal
> program-status reporting removed; the Pi host now reports OSC 7501 from the
> dialog's `blocked` option), plus `src/render-call.ts` (new — builds the
> transcript lines for a finished ask_user call, one line per question with
> its option labels) and `src/tool.ts` `renderCall` (patched to use it).
> Re-apply these changes after updating from upstream.

A Pi extension that adds an `ask_user` tool, with optional integration with
[Herdr](https://herdr.dev) agent state.

## Structure

```text
index.ts      # Pi auto-discovery entry point
src/
  tool.ts     # Tool registration and parameter schema
  ui.ts       # Batch question wizard (text, confirm, select, multiselect)
  herdr.ts    # Herdr event-bus integration
  program-status.ts # OSC 7501 terminal status (blocked while asking)
  options.ts  # Option normalization
  render-call.ts # Transcript lines for a finished ask_user call (local patch)
  types.ts    # Shared TypeScript types
```

## What it does

- Registers an `ask_user` tool that asks the user **one or more questions in a
  single call**. Each question can be:
  - free-form text (`type: "text"`)
  - yes/no confirmation (`type: "confirm"`)
  - single choice from a list (`type: "select"`)
  - multiple choices from a list (`type: "multiselect"`)
- All questions are answered inside one wizard UI:
  - a progress header (`Question 2/4` + progress bar) when there are multiple
    questions
  - **Enter** submits and moves to the next question
  - **Esc** steps back one layer (custom input → options → previous question)
  - **Ctrl+C** cancels the whole batch immediately
  - previously answered questions keep their answers when navigating back
  - long option labels and descriptions wrap instead of being truncated,
    including continuous CJK text and long unbroken words
- Agent-facing results stay compact (`1 -> answer`), while the tool result UI
  retains each question alongside its answer for easy review.
- For `select` and `multiselect`, an **"Other (custom)"** option is always
  available so the user can type their own answer.
- For `confirm`, you can enable the same custom option with
  `"allow_custom": true`.
- No extra slash command is registered — only the `ask_user` tool.
- When Pi runs inside a Herdr pane, it reports the pane state as `blocked`
  while waiting, shows the pending question(s) as a sidebar token, and
  restores both after the user answers. (Herdr itself shows a notification
  for blocked panes, so the extension no longer sends its own.)
- While waiting (in any terminal), it reports `blocked` with the
  [Program Status Protocol (OSC 7501)](https://www.superlogical.com/rex/docs/build/program-status),
  so Rex and other OSC 7501 hosts show the prompt in tab headers, session
  pickers, and status rows. Pi's `working` state is restored afterwards.

## Install

### From npm (recommended)

```bash
pi install npm:pi-ask-herdr
```

Then reload Pi with `/reload`.

### From git

```bash
pi install git:github.com/leset0ng/pi-ask-herdr@v0.3.0
```

### Manual

Copy or clone this directory into Pi's extensions folder:

```bash
# Global
cp -R pi-ask-herdr ~/.pi/agent/extensions/

# Or project-local
cp -R pi-ask-herdr .pi/extensions/
```

Then reload Pi with `/reload`, or test it directly with:

```bash
pi -e ~/.pi/agent/extensions/pi-ask-herdr/index.ts
```

## Tool usage

A single question (one-element `questions` array):

```json
{
  "questions": [
    {
      "question": "Which database should we use?",
      "type": "select",
      "options": ["PostgreSQL", "SQLite", "MySQL"]
    }
  ]
}
```

Multiple questions in one call:

```json
{
  "questions": [
    {
      "question": "Which database should we use?",
      "type": "select",
      "options": [
        { "label": "PostgreSQL", "description": "Full-featured relational database" },
        { "label": "SQLite", "description": "Zero-config file database" },
        { "label": "MySQL", "description": "Widely used open-source RDBMS" }
      ]
    },
    {
      "question": "Which features should we enable?",
      "type": "multiselect",
      "options": ["dark mode", "notifications", "auto-save"]
    },
    {
      "question": "Any additional notes?",
      "type": "text"
    }
  ]
}
```

### Parameters

| Name         | Type       | Required | Description                                                   |
|--------------|------------|----------|---------------------------------------------------------------|
| questions    | object[]   | yes      | Questions to ask, in order (min 1). See per-question fields.  |
| timeout      | number     | no       | Total timeout in milliseconds for the whole batch             |

Per-question fields:

| Name         | Type                 | Required | Description                                      |
|--------------|----------------------|----------|--------------------------------------------------|
| question     | string               | yes      | The question to display                          |
| type         | string               | no       | `"text"`, `"confirm"`, `"select"`, `"multiselect"` (default: text) |
| options      | string[] or object[] | no       | Required when `type` is `select` or `multiselect`. Each item can be a string or `{ "label": string, "description"?: string }` |
| default      | string               | no       | Prefilled value for text input                               |
| allow_custom | boolean              | no       | For `confirm`: also offer "Other (custom)"                   |

### Key bindings

| Key    | Action                                                            |
|--------|-------------------------------------------------------------------|
| Enter  | Submit current question and advance (on the last question: finish) |
| Esc    | Step back one layer: custom input → options → previous question    |
| Ctrl+C | Cancel the whole batch immediately (answers are discarded)         |
| Space  | Toggle an option in `multiselect` questions                        |

## Herdr integration

The extension detects Herdr via the environment variables that Herdr injects
into its panes:

- `HERDR_ENV=1`
- `HERDR_SOCKET_PATH`
- `HERDR_PANE_ID`

If these are present, the extension:

- emits `herdr:blocked` with `active: true` before prompting (the official
  Herdr Pi integration turns this into a `blocked` pane state, which Herdr
  surfaces as a notification)
- reports the first pending question and remaining count as separate pane
  metadata tokens while waiting, allowing Herdr to truncate the question as
  the sidebar is resized while preserving `+N`
- emits `herdr:blocked` with `active: false` and clears the token after the
  user answers

### Sidebar display

For one question the row shows the question text itself. For multiple questions,
Herdr renders the short count as a separate token, for example
`❓ Which database should we use? · +2`. Keeping `$ask_count` separate ensures
it remains visible while `$ask` is truncated responsively as the sidebar is
resized.

To render the tokens in Herdr's sidebar, add `$ask` and `$ask_count` to the same
agent row in `~/.config/herdr/config.toml`, then run
`herdr server reload-config`:

```toml
[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent", "$ask", "$ask_count"]]
```

Without this config the token is simply not displayed; everything else works
the same.

No extra configuration is required.

## Terminal program status (OSC 7501)

While `ask_user` waits for an answer, the extension reports
`state=blocked:kind=question` on Pi's root program-status record, with the first
question as the `msg`. When the prompt closes, the previous `working` state is
restored:

```text
ESC ] 7501 ; state=blocked:app=pi:kind=question:msg=V2hpY2ggZGF0YWJhc2U/ IFBpY2sgb25l ESC \
```

This is what terminals such as Rex render for tab spinners and blocked
indicators. Nothing changes when the terminal does not support the protocol.

Pi sends these reports only after the terminal answers the protocol's support
query. tmux and screen do not forward that reply, so set `PI_PROGRAM_STATUS=1`
to report unconditionally (and `PI_PROGRAM_STATUS=0` to turn it off).

## License

MIT
