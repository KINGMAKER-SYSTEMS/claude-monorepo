import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { summarizeProjects } = vi.hoisted(() => ({ summarizeProjects: vi.fn() }));
vi.mock("@brain/embedder", () => ({ summarizeProjects }));

// Silence the @clack/prompts spinner in tests.
vi.mock("@clack/prompts", () => ({
  spinner: () => ({ start: () => void 0, stop: () => void 0 }),
}));

import { runSummarize } from "./summarize.js";

describe("brain summarize CLI", () => {
  const originalKey = process.env["ANTHROPIC_API_KEY"];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    summarizeProjects.mockReset();
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => void 0);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => void 0);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (originalKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
    else process.env["ANTHROPIC_API_KEY"] = originalKey;
  });

  it("returns 1 and warns when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const code = await runSummarize({});
    expect(code).toBe(1);
    expect(summarizeProjects).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it("calls summarizeProjects and reports stats on success", async () => {
    summarizeProjects.mockResolvedValue({ summarized: 3, skipped: 1, embedded: 4 });
    const code = await runSummarize({});
    expect(code).toBe(0);
    expect(summarizeProjects).toHaveBeenCalledOnce();
    expect(summarizeProjects).toHaveBeenCalledWith({});
  });

  it("forwards --limit, --model, and --force to summarizeProjects", async () => {
    summarizeProjects.mockResolvedValue({ summarized: 0, skipped: 0, embedded: 0 });
    await runSummarize({ limit: 5, model: "claude-test", force: true });
    expect(summarizeProjects).toHaveBeenCalledWith({
      limit: 5,
      model: "claude-test",
      skipIfFresh: false,
    });
  });

  it("emits JSON in --json mode", async () => {
    summarizeProjects.mockResolvedValue({ summarized: 2, skipped: 0, embedded: 2 });
    const code = await runSummarize({ json: true });
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(JSON.parse(printed)).toEqual({ summarized: 2, skipped: 0, embedded: 2 });
  });

  it("returns 1 when summarizeProjects throws", async () => {
    summarizeProjects.mockRejectedValue(new Error("boom"));
    const code = await runSummarize({});
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
