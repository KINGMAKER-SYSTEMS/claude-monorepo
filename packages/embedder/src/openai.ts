import type { Embedder, EmbedRequest, EmbedResponse, EmbedderConfig } from "./types.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIM = 1536;

/**
 * OpenAI embedder — also works against any OpenAI-compatible endpoint
 * (e.g. Azure, together.ai, openrouter). Override via EmbedderConfig.endpoint.
 */
export class OpenAIEmbedder implements Embedder {
  readonly provider = "openai";
  readonly modelId: string;
  readonly dim: number;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(cfg: EmbedderConfig) {
    this.modelId = cfg.model ?? DEFAULT_MODEL;
    this.dim = cfg.dim ?? DEFAULT_DIM;
    this.endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT;
    const key = cfg.apiKey ?? process.env["OPENAI_API_KEY"];
    if (!key) {
      throw new Error(
        "OpenAI embedder requires an API key — set OPENAI_API_KEY or [embedder].api_key in config",
      );
    }
    this.apiKey = key;
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    if (req.inputs.length === 0) {
      return { vectors: [], modelId: this.modelId, provider: this.provider, dim: this.dim };
    }
    const body: Record<string, unknown> = {
      model: this.modelId,
      input: req.inputs,
    };
    // Only send `dimensions` if the model supports it (text-embedding-3-*).
    if (this.modelId.startsWith("text-embedding-3") && this.dim !== DEFAULT_DIM) {
      body["dimensions"] = this.dim;
    }

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`openai embeddings ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
    };
    const vectors = new Array<number[]>(req.inputs.length);
    for (const row of json.data) {
      vectors[row.index] = row.embedding;
    }
    return {
      vectors,
      modelId: json.model ?? this.modelId,
      provider: this.provider,
      dim: vectors[0]?.length ?? this.dim,
    };
  }
}
