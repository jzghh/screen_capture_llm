# M3 — Pluggable LLM providers (non-streaming)

The extension routes chat requests through a small provider registry instead of
hard-coding one vendor. Switching between Claude, OpenAI, DeepSeek, Groq,
Ollama (local), etc. is done from the popup.

## Setup

1. Load this folder via `chrome://extensions` → **Load unpacked**.
2. Open the popup → choose a **Provider** → paste API key → optionally set
   **Model ID** / **Base URL** → **Save provider settings**.
3. Visit any `http(s)` page, select text → bubble → panel → ask.

The popup keeps a per-provider draft, so switching providers in the dropdown
preserves keys/models/base URLs you have entered for the others until you save.

## Architecture

| Piece | Role |
|--------|------|
| `content.js` | UI; sends `{ type: "ASK_LLM_CHAT", selection, question }` |
| `background.js` | Reads provider config from `chrome.storage.local`, calls `runProvider(id, ...)` |
| `providers/index.js` | Loads `providers.json`; dispatches by `kind` to an adapter |
| `providers/adapters/openai-compat.js` | Family adapter for OpenAI-compatible `/chat/completions` |
| `providers/adapters/anthropic.js` | Adapter for Anthropic Messages API |
| `providers/providers.json` | Declarative registry of providers |
| `popup.{html,js}` | Provider `<select>` + fields, writes per-provider maps to storage |

## Storage schema

```text
askLlmEnabled   : boolean
askLlmProvider  : string                // current provider id
askLlmKeys      : { [providerId]: string }
askLlmModels    : { [providerId]: string }   // empty means "use defaultModel"
askLlmBaseUrls  : { [providerId]: string }   // empty means "use defaultBaseUrl"
```

Legacy `askLlmApiKey` / `askLlmModel` (M3.0) are migrated into
`askLlmKeys.anthropic` / `askLlmModels.anthropic` on first load and removed.

## Adding a new provider

### Case A — OpenAI-compatible API (no code)

Most providers expose `POST /chat/completions` with `Authorization: Bearer ...`.
Append an entry to [`providers/providers.json`](providers/providers.json):

```json
{
  "id": "together",
  "label": "Together AI",
  "kind": "openai-compat",
  "defaultBaseUrl": "https://api.together.xyz/v1",
  "defaultModel": "meta-llama/Llama-3-70b-chat-hf",
  "authHint": "Bearer ..."
}
```

Reload the extension; it appears in the popup dropdown immediately.

If a provider needs no auth (e.g. local Ollama at `/v1`), set `"noAuth": true`.

### Case B — Heterogeneous API (one new adapter file)

For vendors with a different request/response shape (e.g. Google Gemini's
`generativelanguage.googleapis.com` endpoints), write a small adapter under
`providers/adapters/` that exports the same shape as the existing ones:

```js
// providers/adapters/gemini.js
export default {
  async complete({ apiKey, baseUrl, model, system, user, provider, signal }) {
    // 1) build URL/headers/body for that vendor
    // 2) fetch + parse + return string
  },
};
```

Register the adapter in [`providers/index.js`](providers/index.js):

```js
import gemini from "./adapters/gemini.js";

const ADAPTERS = {
  "openai-compat": openaiCompat,
  "anthropic": anthropic,
  "gemini": gemini,
};
```

Then add an entry with `"kind": "gemini"` to `providers.json`.

## Prompting / safety

System prompt marks the page selection as untrusted inside
`<page_selection>...</page_selection>` to reduce prompt-injection success.
This is mitigation, not a guarantee — adversarial page text remains an attack
surface.

API keys in an unpacked / dev extension are for **learning only**. A public
store build must not ship secrets; M6 introduces a backend that holds them.

## References

- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [Groq API](https://console.groq.com/docs/openai)
- [Ollama OpenAI-compatible API](https://github.com/ollama/ollama/blob/main/docs/openai.md)
