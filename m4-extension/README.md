# M4 — SSE Streaming + Markdown + Multi-turn

Builds on M3's pluggable-provider architecture and adds:

- **SSE streaming** — answer appears word-by-word instead of waiting for the full response.
- **Markdown rendering** — `marked` parses the model's output; `DOMPurify` sanitises the HTML; `highlight.js` syntax-highlights code blocks.
- **Multi-turn conversation** — the panel keeps a scrollable history of turns; all previous turns are sent with each new request.
- **AbortController / Stop button** — cancel an in-flight stream any time.
- **Keyboard shortcut** — `Ctrl/Cmd + Enter` to submit.

## Setup

1. `chrome://extensions` → **Load unpacked** → this folder (`m4-extension`).
2. Open popup → choose provider → paste API key → **Save**.
3. Visit any `http(s)` page, select text → bubble → panel → ask.

## Key concepts in this milestone

### Why chrome.runtime.connect() instead of sendMessage?

`sendMessage` is one-shot (one response callback). Streaming requires **many
chunks** arriving over time, so M4 uses a long-lived **Port**:

```
content.js                         background.js
  |                                    |
  |-- connect({ name:"ask-llm-stream" })->port
  |-- port.postMessage(STREAM_START) -->|
  |                                    |-- fetch SSE from provider
  |<-- port.postMessage({ CHUNK })  ---|   (reads ReadableStream)
  |<-- port.postMessage({ CHUNK })  ---|
  |<-- port.postMessage({ DONE  })  ---|
```

When content disconnects the port (panel close / Stop button), background's
`port.onDisconnect` fires and calls `abortController.abort()`, which closes the
`fetch` body reader.

### requestAnimationFrame batching

Each SSE chunk calls `scheduleFlush()` which buffers text and schedules one
`requestAnimationFrame`. The rAF callback re-renders the full Markdown string
once per frame (~60 fps max), preventing layout thrash from hundreds of tiny
DOM mutations per second.

### Multi-turn message list

Conversation history is a plain array `[{ role, content }, ...]`.  The full
history is sent to the provider with each new turn.  The system prompt (with
the `<page_selection>` anti-injection wrapper) is always sent as the top-level
`system` parameter.

## Architecture

| File | Role |
|------|------|
| `background.js` | `onConnect` → port handler → `streamProvider()` → chunks |
| `providers/index.js` | `streamProvider(id, params)` → routes to adapter |
| `providers/adapters/openai-compat.js` | `async *stream()` reads OpenAI SSE chunks |
| `providers/adapters/anthropic.js` | `async *stream()` reads Anthropic SSE events |
| `content.js` | Port client + rAF flush + marked/DOMPurify/hljs + history panel |
| `vendor/` | `marked.min.js`, `dompurify.min.js`, `highlight.min.js` |

## Adding a new provider

Same as M3: add a line to `providers/providers.json` (OpenAI-compat) or a new
adapter with both `complete()` and `stream()` methods (heterogeneous).

## Reference

- [Anthropic SSE streaming](https://docs.anthropic.com/en/api/messages-streaming)
- [OpenAI streaming](https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream)
- [Chrome runtime.connect](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connect)
- [marked docs](https://marked.js.org/)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [highlight.js](https://highlightjs.org/)
