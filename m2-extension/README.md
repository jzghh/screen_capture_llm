# M2 — Minimal Chrome extension (Manifest V3)

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this folder (`m2-extension`).

## Try it

1. Open any `http://` or `https://` page (e.g. Wikipedia).
2. Select text → bubble → panel (same flow as M1).
3. Open the extension popup (toolbar icon) → toggle **Enable** off → select text again → bubble should not appear.
4. Click **Ping service worker** to verify `chrome.runtime.sendMessage` to the MV3 service worker.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 entry: permissions, content scripts, action popup, background worker |
| `background.js` | Service worker: default storage + `onMessage` demo |
| `content.js` / `content.css` | Isolated-world UI injected into web pages |
| `popup.html` + `popup.js` + `popup.css` | Toolbar popup; writes `chrome.storage.local` |

`file://` pages do not get content scripts with the current `matches`; use a normal website for testing.
