import type { Embedder, EmbedRequest, EmbedResponse, EmbedderConfig } from "./types.js";

const DEFAULT_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3-lite";

export class VoyageEmbedder implements Embedder {
  readonly provider = "voyage";
  readonly modelId: string;
  readonly dim: number;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(cfg: EmbedderConfig) {
    this.modelId = cfg.model ?? DEFAULT_MODEL;
    // voyage-3-lite → 512, voyage-3 → 1024. We keep the configured dim; the
    // caller is responsible for lining up with the embeddings table column.
    this.dim = cfg.dim ?? 1024;
    this.endpoint = cfg.endpoint ?? DEFAULT_ENDPOINT;
    const key = cfg.apiKey ?? process.env["VOYAGE_API_KEY"];
    if (!key) {
      throw new Error(
        "Voyage embedder requires an API key — set VOYAGE_API_KEY or [embedder].api_key",
      );
    }
    this.apiKey = key;
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    if (req.inputs.length === 0) {
      return { vectors: [], modelId: this.modelId, provider: this.provider, dim: this.dim };
    }
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.modelId, input: req.inputs }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`voyage embeddings ${res.status}: ${text.slice(0, 300)}`);
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
