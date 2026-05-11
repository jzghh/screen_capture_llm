
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Ask LLM",
    version: "0.6.0",
    description: "Select text on any page, ask an LLM about it. Supports multiple providers with streaming Markdown answers.",
    permissions: ["storage", "contextMenus"],
    // Broad host_permissions are required because the content script uses
    // declarative `matches` to auto-inject on every page for text-selection
    // detection. Switching to `activeTab` + `chrome.scripting.executeScript`
    // would remove the auto-appearing bubble (UX regression) and require a
    // full architectural rework. Revisit when Chrome offers a better model
    // for on-demand content scripts with selection awareness.
    host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      "open-panel": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Open Ask LLM panel for selected text",
      },
    },
  },
});
