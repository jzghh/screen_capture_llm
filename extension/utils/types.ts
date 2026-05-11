/** A single entry in providers.json */
export interface ProviderEntry {
  id: string;
  label: string;
  kind: string;
  defaultBaseUrl: string;
  defaultModel: string;
  authHint?: string;
  noAuth?: boolean;
}

/** The full registry shape */
export interface ProviderRegistry {
  default: string;
  providers: ProviderEntry[];
}

/** One turn in a multi-turn conversation */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Parameters passed to adapter.complete() / adapter.stream() */
export interface AdapterParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  provider: ProviderEntry;
  signal?: AbortSignal;
}

/** Every adapter must export this shape */
export interface Adapter {
  complete(params: AdapterParams): Promise<string>;
  stream(params: AdapterParams): AsyncGenerator<string>;
}

/** Parameters from storage for the current provider */
export interface ProviderParams {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Port message types: content → background */
export interface StreamStartMessage {
  type: "STREAM_START";
  question: string;
  selection: string;
  messages: ChatMessage[];
}

/** Port message types: background → content */
export type StreamPortMessage =
  | { type: "CHUNK"; text: string }
  | { type: "DONE"; provider: string }
  | { type: "ERROR"; error: string };

/** Storage key constants */
export const STORAGE_KEYS = {
  enabled: "askLlmEnabled",
  provider: "askLlmProvider",
  keys: "askLlmKeys",
  models: "askLlmModels",
  baseUrls: "askLlmBaseUrls",
  legacyApiKey: "askLlmApiKey",
  legacyModel: "askLlmModel",
  mode: "askLlmMode",
  backendUrl: "askLlmBackendUrl",
  backendToken: "askLlmBackendToken",
} as const;

export type ConnectionMode = "self-hosted" | "backend";

export const PORT_NAME = "ask-llm-stream";
export const MAX_SELECTION_CHARS = 200_000;
export const MAX_RESPONSE_TOKENS = 4096;
export const MAX_HISTORY_MESSAGES = 20;
