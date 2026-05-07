export interface Env {
  KV: KVNamespace;
  ALLOWED_ORIGIN: string;
  // LLM keys stored as secrets via `wrangler secret put`
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GROQ_API_KEY?: string;
  ADMIN_SECRET?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  provider: string;
  model?: string;
  system: string;
  messages: ChatMessage[];
}

export interface ProviderConfig {
  id: string;
  label: string;
  kind: "openai-compat" | "anthropic";
  defaultBaseUrl: string;
  defaultModel: string;
  envKey: keyof Env;
}

export interface TokenRecord {
  userId: string;
  createdAt: number;
  rateLimit: number;
}
