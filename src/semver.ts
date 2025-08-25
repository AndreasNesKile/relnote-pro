import type { CategorizeResult } from "./categorize.js";

export type Bump = "major" | "minor" | "patch" | "none";

const norm = (s: string) => s.trim().toLowerCase();

// Kjente kategorinavn (både EN og NO)
const MINOR_CATS = new Set([
  "features",
  "feature",
  "nytt",
  "enhancements",
  "adds",
  "new",
]);
const PATCH_CATS = new Set([
  "fixes",
  "fix",
  "fikser",
  "bug",
  "bugs",
  "docs",
  "dokumentasjon",
  "refactor",
  "refaktorering",
  "tests",
  "test",
  "performance",
  "perf",
  "chore",
  "chores",
  "misc",
  "diverse",
]);

export function suggestBump(input: string | CategorizeResult): Bump {
  const res: CategorizeResult =
    typeof input === "string" ? { category: input, breaking: false } : input;

  if (res.breaking) return "major";

  const key = norm(res.category);

  if (MINOR_CATS.has(key)) return "minor";
  if (PATCH_CATS.has(key)) return "patch";

  // Fuzzy fallback
  if (key.includes("feature") || key.includes("nytt")) return "minor";
  if (
    key.includes("fix") ||
    key.includes("bug") ||
    key.includes("docs") ||
    key.includes("refactor") ||
    key.includes("perf") ||
    key.includes("test") ||
    key.includes("chore") ||
    key.includes("diverse") ||
    key.includes("misc")
  )
    return "patch";

  return "none";
}

// Kombiner flere bump-forslag (major > minor > patch > none)
export function combineBumps(bumps: Bump[]): Bump {
  if (bumps.includes("major")) return "major";
  if (bumps.includes("minor")) return "minor";
  if (bumps.includes("patch")) return "patch";
  return "none";
}
