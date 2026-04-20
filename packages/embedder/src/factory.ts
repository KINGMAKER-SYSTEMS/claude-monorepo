import type { Embedder, EmbedderConfig } from "./types.js";
import { OpenAIEmbedder } from "./openai.js";
import { VoyageEmbedder } from "./voyage.js";
import { OllamaEmbedder } from "./ollama.js";
import { loadEmbedderConfig } from "./config.js";

export function createEmbedder(cfg?: EmbedderConfig): Embedder {
  const c = cfg ?? loadEmbedderConfig();
  switch (c.kind) {
    case "openai":
      return new OpenAIEmbedder(c);
    case "voyage":
      return new VoyageEmbedder(c);
    case "ollama":
      return new OllamaEmbedder(c);
    case "disabled":
      throw new Error("embedder is disabled — set [embedder].kind in ~/.config/brain/config.toml");
    default:
      throw new Error(`unknown embedder kind: ${(c as { kind: string }).kind}`);
  }
}
