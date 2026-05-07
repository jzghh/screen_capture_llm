import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Ask LLM",
    version: "0.6.0",
    description: "Select text on any page, ask an LLM about it. Supports multiple providers with streaming Markdown answers.",
    permissions: ["storage"],
    host_permissions: ["http://*/*", "https://*/*"],
  },
});
