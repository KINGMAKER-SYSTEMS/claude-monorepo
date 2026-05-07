import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { refineOpenLoops } = vi.hoisted(() => ({ refineOpenLoops: vi.fn() }));
vi.mock("@brain/embedder", () => ({ refineOpenLoops }));

vi.mock("@clack/prompts", () => ({
  spinner: () => ({ start: () => void 0, stop: () => void 0 }),
}));

import { runRefine } from "./refine.js";

describe("brain refine CLI", () => {
  const originalKey = process.env["ANTHROPIC_API_KEY"];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    refineOpenLoops.mockReset();
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
    const code = await runRefine({});
    expect(code).toBe(1);
    expect(refineOpenLoops).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it("calls refineOpenLoops and reports stats", async () => {
    refineOpenLoops.mockResolvedValue({ refined: 7, embedded: 7 });
    const code = await runRefine({});
    expect(code).toBe(0);
    expect(refineOpenLoops).toHaveBeenCalledOnce();
    expect(refineOpenLoops).toHaveBeenCalledWith({});
  });

  it("parses --since into a Date and forwards --limit/--model", async () => {
    refineOpenLoops.mockResolvedValue({ refined: 0, embedded: 0 });
    await runRefine({ limit: 10, model: "claude-test", since: "2026-01-01T00:00:00Z" });
    expect(refineOpenLoops).toHaveBeenCalledOnce();
    const arg = refineOpenLoops.mock.calls[0]![0] as {
      limit: number;
      model: string;
      since: Date;
    };
    expect(arg.limit).toBe(10);
    expect(arg.model).toBe("claude-test");
    expect(arg.since).toBeInstanceOf(Date);
    expect(arg.since.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects an invalid --since with exit code 1", async () => {
    const code = await runRefine({ since: "not-a-date" });
    expect(code).toBe(1);
    expect(refineOpenLoops).not.toHaveBeenCalled();
  });

  it("emits JSON in --json mode", async () => {
    refineOpenLoops.mockResolvedValue({ refined: 4, embedded: 4 });
    const code = await runRefine({ json: true });
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(JSON.parse(printed)).toEqual({ refined: 4, embedded: 4 });
  });
});
