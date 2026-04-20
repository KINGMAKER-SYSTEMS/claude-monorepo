import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIEmbedder } from "./openai.js";

describe("OpenAIEmbedder", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env["OPENAI_API_KEY"];

  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = originalKey;
  });

  it("calls the API and returns vectors in input order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "text-embedding-3-small",
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const e = new OpenAIEmbedder({ kind: "openai" });
    const res = await e.embed({ inputs: ["hi", "there"] });
    expect(res.vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(res.provider).toBe("openai");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.input).toEqual(["hi", "there"]);
    expect(body.model).toBe("text-embedding-3-small");
  });

  it("throws when no API key is available", () => {
    delete process.env["OPENAI_API_KEY"];
    expect(() => new OpenAIEmbedder({ kind: "openai" })).toThrow(/API key/);
  });

  it("passes dimensions override for text-embedding-3 models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: "text-embedding-3-small", data: [{ index: 0, embedding: [0] }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const e = new OpenAIEmbedder({ kind: "openai", dim: 512 });
    await e.embed({ inputs: ["x"] });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.dimensions).toBe(512);
  });

  it("surfaces non-2xx responses as errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "bad key",
    }) as unknown as typeof fetch;
    const e = new OpenAIEmbedder({ kind: "openai" });
    await expect(e.embed({ inputs: ["x"] })).rejects.toThrow(/401/);
  });

  it("returns empty vectors without calling API when input is empty", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const e = new OpenAIEmbedder({ kind: "openai" });
    const res = await e.embed({ inputs: [] });
    expect(res.vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
