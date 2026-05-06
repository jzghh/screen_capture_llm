import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Ask LLM",
    version: "0.5.0",
    description: "Select text on any page, ask an LLM about it.",
    permissions: ["storage"],
    host_permissions: ["http://*/*", "https://*/*"],
  },
});
