import type { CategorizeResult } from "./categorize.js";

export type Bump = "major" | "minor" | "patch" | "none";

const norm = (s: string) => s.trim().toLowerCase();

const MINOR_CATS = new Set([
  "features",
  "feature",
  "enhancements",
  "adds",
  "new",
]);

const PATCH_CATS = new Set([
  "fixes",
  "fix",
  "bug",
  "bugs",
  "docs",
  "documentation",
  "refactor",
  "tests",
  "test",
  "performance",
  "perf",
  "chore",
  "chores",
  "misc",
]);

/** Suggest a SemVer bump based on category + breaking flag. */
export function suggestBump(input: string | CategorizeResult): Bump {
  const res: CategorizeResult =
    typeof input === "string" ? { category: input, breaking: false } : input;

  if (res.breaking) return "major";

  const key = norm(res.category);

  if (MINOR_CATS.has(key)) return "minor";
  if (PATCH_CATS.has(key)) return "patch";

  // Fuzzy fallback
  if (key.includes("feature")) return "minor";
  if (
    key.includes("fix") ||
    key.includes("bug") ||
    key.includes("docs") ||
    key.includes("refactor") ||
    key.includes("perf") ||
    key.includes("test") ||
    key.includes("chore") ||
    key.includes("misc")
  ) {
    return "patch";
  }

  return "none";
}

/** Combine multiple bump suggestions (major > minor > patch > none). */
export function combineBumps(bumps: Bump[]): Bump {
  if (bumps.includes("major")) return "major";
  if (bumps.includes("minor")) return "minor";
  if (bumps.includes("patch")) return "patch";
  return "none";
}
