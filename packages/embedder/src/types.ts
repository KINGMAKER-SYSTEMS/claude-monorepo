export interface EmbedRequest {
  inputs: string[];
}

export interface EmbedResponse {
  vectors: number[][];
  /** Actual model id used, e.g. "text-embedding-3-small". */
  modelId: string;
  /** Actual provider name, e.g. "openai". */
  provider: string;
  /** Dimension of returned vectors. */
  dim: number;
}

export interface Embedder {
  readonly provider: string;
  readonly modelId: string;
  readonly dim: number;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
}

export type EmbedderKind = "openai" | "voyage" | "ollama" | "disabled";

export interface EmbedderConfig {
  kind: EmbedderKind;
  model?: string;
  /** Dimension override (OpenAI text-embedding-3-* supports it). */
  dim?: number;
  /** Endpoint override — used for ollama or custom openai-compatible servers. */
  endpoint?: string;
  apiKey?: string;
}
