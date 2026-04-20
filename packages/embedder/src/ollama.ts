import type { Embedder, EmbedRequest, EmbedResponse, EmbedderConfig } from "./types.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/embeddings";
const DEFAULT_MODEL = "nomic-embed-text";

/**
 * Ollama embedder — the server must be running locally. Ollama's API takes
 * one prompt at a time, so we loop sequentially. Good enough for low-volume
 * local indexing; use OpenAI for batch work.
 */
export class OllamaEmbedder implements Embedder {
  readonly provider = "ollama";
  readonly modelId: string;
  readonly dim: number;
  private readonly endpoint: string;

  constructor(cfg: EmbedderConfig) {
    this.modelId = cfg.model ?? DEFAULT_MODEL;
    this.dim = cfg.dim ?? 768;
    this.endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT;
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const vectors: number[][] = [];
    for (const input of req.inputs) {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.modelId, prompt: input }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ollama embeddings ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { embedding: number[] };
      vectors.push(json.embedding);
    }
    return {
      vectors,
      modelId: this.modelId,
      provider: this.provider,
      dim: vectors[0]?.length ?? this.dim,
    };
  }
}
