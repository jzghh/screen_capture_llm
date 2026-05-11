
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Ask LLM",
    version: "0.6.0",
    description: "Select text on any page, ask an LLM about it. Supports multiple providers with streaming Markdown answers.",
    permissions: ["storage", "contextMenus"],
    host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      "open-panel": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Open Ask LLM panel for selected text",
      },
    },
  },
});
