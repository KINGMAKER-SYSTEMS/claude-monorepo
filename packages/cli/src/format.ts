import Table from "cli-table3";
import pc from "picocolors";

export function makeTable(head: string[]): Table.Table {
  return new Table({
    head: head.map((h) => pc.bold(pc.cyan(h))),
    style: { head: [], border: ["gray"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });
}

export function dim(s: string): string {
  return pc.dim(s);
}

export function formatRelativeTime(d: Date | null | undefined): string {
  if (!d) return pc.dim("never");
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function statusBadge(isDirty: boolean | null): string {
  if (isDirty === null) return pc.dim("—");
  return isDirty ? pc.yellow("dirty") : pc.green("clean");
}
