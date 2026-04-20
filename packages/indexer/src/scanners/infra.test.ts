import { describe, it, expect } from "vitest";
import {
  parseDockerPsOutput,
  parseLsofOutput,
  guessFramework,
  assignDevServerToProject,
  assignContainerToProject,
} from "./infra.js";

describe("parseDockerPsOutput", () => {
  it("parses one line per container", () => {
    const stdout = [
      JSON.stringify({
        ID: "abc123",
        Names: "brain-postgres",
        Image: "pgvector/pgvector:pg16",
        Status: "Up 2 hours",
        State: "running",
        Ports: "0.0.0.0:55432->5432/tcp",
        Labels:
          "com.docker.compose.project=brain,com.docker.compose.service=db,com.docker.compose.project.working_dir=/Users/me/dev/brain",
      }),
      "",
      JSON.stringify({
        ID: "def456",
        Names: "web",
        Image: "node:22",
        Status: "Exited (0) 5 minutes ago",
        State: "exited",
        Ports: "",
        Labels: "",
      }),
    ].join("\n");

    const rows = parseDockerPsOutput(stdout);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "abc123",
      name: "brain-postgres",
      image: "pgvector/pgvector:pg16",
      state: "running",
      composeProject: "brain",
      composeService: "db",
      composeWorkingDir: "/Users/me/dev/brain",
    });
    expect(rows[1]?.state).toBe("exited");
    expect(rows[1]?.composeProject).toBeUndefined();
  });

  it("infers state from status when missing", () => {
    const stdout = JSON.stringify({
      ID: "x",
      Names: "n",
      Image: "i",
      Status: "Up 10 seconds",
      State: "",
      Ports: "",
      Labels: "",
    });
    const rows = parseDockerPsOutput(stdout);
    expect(rows[0]?.state).toBe("running");
  });

  it("skips malformed lines", () => {
    const stdout = `{bad json}\n${JSON.stringify({ ID: "a", Names: "n", Image: "i", Status: "", State: "running", Ports: "", Labels: "" })}\n`;
    const rows = parseDockerPsOutput(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("a");
  });
});

describe("parseLsofOutput", () => {
  it("parses lsof -F pcPn records", () => {
    const stdout = [
      "p12345",
      "cnode",
      "PTCP",
      "n*:3000",
      "p12345",
      "cnode",
      "PTCP",
      "n*:3001",
      "p99",
      "csshd",
      "PTCP",
      "n*:22",
    ].join("\n");

    const rows = parseLsofOutput(stdout);
    // node on 3000 and 3001 should be kept; sshd on 22 is filtered
    const ports = rows.map((r) => r.port).sort();
    expect(ports).toEqual([3000, 3001]);
    expect(rows.every((r) => r.command === "node")).toBe(true);
    expect(rows.every((r) => r.pid === 12345)).toBe(true);
  });

  it("handles bracketed IPv6 addresses", () => {
    const stdout = ["p777", "cvite", "PTCP", "n[::1]:5173"].join("\n");
    const rows = parseLsofOutput(stdout);
    expect(rows[0]?.port).toBe(5173);
  });

  it("filters out non-dev ports with unknown commands", () => {
    const stdout = ["p42", "cwierddaemon", "PTCP", "n*:111"].join("\n");
    const rows = parseLsofOutput(stdout);
    expect(rows).toHaveLength(0);
  });

  it("keeps unknown commands in dev port range", () => {
    const stdout = ["p42", "cmyserver", "PTCP", "n*:8080"].join("\n");
    const rows = parseLsofOutput(stdout);
    expect(rows).toHaveLength(1);
  });
});

describe("guessFramework", () => {
  it("maps common commands", () => {
    expect(guessFramework("next-server")).toBe("next");
    expect(guessFramework("node /path/to/vite")).toBe("vite");
    expect(guessFramework("bun run dev")).toBe("bun");
    expect(guessFramework("puma 6.4")).toBe("rails");
    expect(guessFramework("uvicorn main:app")).toBe("django");
    expect(guessFramework("node something")).toBe("node");
  });

  it("returns undefined for unknown", () => {
    expect(guessFramework("my-exotic-thing")).toBeUndefined();
  });
});

describe("assignDevServerToProject", () => {
  const projects = [
    { id: "a", rootPath: "/Users/me/dev/brain" },
    { id: "b", rootPath: "/Users/me/dev/brain/packages/cli" },
    { id: "c", rootPath: "/Users/me/dev/other" },
  ];

  it("chooses longest matching prefix", () => {
    expect(assignDevServerToProject("/Users/me/dev/brain/packages/cli/src", projects)).toBe("b");
    expect(assignDevServerToProject("/Users/me/dev/brain/packages/db", projects)).toBe("a");
    expect(assignDevServerToProject("/Users/me/dev/other/sub", projects)).toBe("c");
  });

  it("returns null when no match", () => {
    expect(assignDevServerToProject("/tmp/foo", projects)).toBeNull();
    expect(assignDevServerToProject(undefined, projects)).toBeNull();
  });
});

describe("assignContainerToProject", () => {
  it("uses compose working_dir label", () => {
    const projects = [{ id: "x", rootPath: "/dev/thing" }];
    const container = {
      id: "",
      name: "",
      image: "",
      status: "",
      state: "",
      ports: "",
      labels: {},
      composeWorkingDir: "/dev/thing",
    };
    expect(assignContainerToProject(container, projects)).toBe("x");
  });

  it("returns null with no hint", () => {
    const container = {
      id: "",
      name: "",
      image: "",
      status: "",
      state: "",
      ports: "",
      labels: {},
    };
    expect(assignContainerToProject(container, [])).toBeNull();
  });
});
