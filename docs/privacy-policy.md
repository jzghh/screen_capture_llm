# Ask LLM — Privacy Policy

**Last updated**: 2026-05-06

## What data we collect

### Self-hosted mode
When using "Self-hosted" mode, the extension communicates directly between your browser and the LLM API provider you configured (e.g. Anthropic, OpenAI). **No data passes through our servers.** Your API keys are stored locally in `chrome.storage.local` on your device.

### Backend mode
When using "Backend" mode, the extension sends the following to our server:
- The text you selected on a webpage
- Your question about that text
- Your conversation history (for multi-turn follow-ups)
- Your chosen provider and model

This data is forwarded to the LLM provider to generate a response and is **not stored** on our servers beyond the duration of the request.

## What data we do NOT collect
- We do not collect browsing history
- We do not collect personal information
- We do not track which websites you visit
- We do not store the content of your queries (backend mode forwards and discards)
- We do not use cookies or analytics trackers

## Authentication tokens
Backend mode requires an auth token. Tokens are used solely for access control and rate limiting. They are stored in Cloudflare Workers KV and do not contain personal information.

## Third-party services
Depending on your configuration, your selected text and questions may be sent to:
- Anthropic (Claude API)
- OpenAI (ChatGPT API)
- DeepSeek
- Groq
- A local Ollama instance

Each provider has its own privacy policy. We encourage you to review them.

## Data security
- API keys in self-hosted mode never leave your device
- Backend communication uses HTTPS
- Auth tokens are randomly generated and can be revoked

## Changes to this policy
We may update this policy. Changes will be reflected in the "Last updated" date above.

## Contact
For questions about this privacy policy, open an issue on our GitHub repository.
