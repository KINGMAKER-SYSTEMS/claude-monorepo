export type ProjectKind = "node" | "rust" | "go" | "python" | "ruby" | "mixed" | "unknown";

export type ManifestSource =
  | "package_json"
  | "pnpm_lock"
  | "cargo_toml"
  | "go_mod"
  | "pyproject_toml"
  | "requirements_txt"
  | "gemfile";

export interface DetectedProject {
  rootPath: string;
  name: string;
  kind: ProjectKind;
  hasGit: boolean;
}
