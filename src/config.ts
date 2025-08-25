import fs from "node:fs/promises";
import yaml from "js-yaml";

export type Config = {
  changelogPath: string;
  categories: Record<string, string[]>; // e.g., "Features" -> ["feature", "feat"]
  breakingLabels: string[]; // e.g., ["breaking", "breaking-change"]
  monorepo: { enabled: boolean; packages?: string[]; detect?: boolean };
  excludePaths?: string[];
  language?: "en"; // English-only
};

export async function loadConfig(path: string): Promise<Config> {
  try {
    const raw = yaml.load(await fs.readFile(path, "utf8")) as Partial<Config>;
    return applyDefaults(raw);
  } catch {
    return applyDefaults({});
  }
}

function applyDefaults(raw: Partial<Config>): Config {
  return {
    changelogPath: raw.changelogPath ?? "CHANGELOG.md",
    categories: raw.categories ?? {
      Features: ["feature", "feat", "enhancement"],
      Fixes: ["fix", "bug", "bugfix", "hotfix"],
      Docs: ["docs", "documentation"],
      Performance: ["perf", "performance"],
      Refactor: ["refactor", "refactoring"],
      Tests: ["test", "tests"],
      Chores: ["chore", "maintenance"],
    },
    breakingLabels: raw.breakingLabels ?? [
      "breaking",
      "breaking-change",
      "major",
    ],
    monorepo: raw.monorepo ?? { enabled: false, detect: true },
    excludePaths: raw.excludePaths ?? [],
    language: "en",
  };
}
