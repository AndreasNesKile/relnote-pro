import type { Config } from "./config.js";

export type CategorizeResult = {
  category: string;
  breaking: boolean;
  scope?: string;
};

// Conventional Commits: type(scope)!: subject
const CC_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;
const BREAKING_TOKENS = ["breaking change", "breaking changes", "breaking"];
const COMMON_LABEL_ALIASES: Record<string, string> = {
  "type: feat": "feat",
  "type: feature": "feat",
  enhancement: "feat",
  feature: "feat",
  feat: "feat",

  "type: fix": "fix",
  bug: "fix",
  bugfix: "fix",
  hotfix: "fix",
  fix: "fix",

  docs: "docs",
  documentation: "docs",

  perf: "perf",
  performance: "perf",

  refactor: "refactor",
  refactoring: "refactor",

  test: "test",
  tests: "test",

  chore: "chore",
  maintenance: "chore",
};

const norm = (s: string) => s.trim().toLowerCase();

function normalizeLabel(l: string): string {
  const n = norm(l);
  // fjern vanlige prefikser
  const stripped = n.replace(/^type:\s*/, "").replace(/^kind:\s*/, "");
  // map kjente varianter
  return COMMON_LABEL_ALIASES[stripped] ?? COMMON_LABEL_ALIASES[n] ?? stripped;
}

export function categorize(
  title: string,
  labels: string[] = [],
  cfg: Config
): CategorizeResult {
  // Bygg mapping alias->kategori basert på config
  const categoryOrder = Object.keys(cfg.categories ?? {});
  const aliasToCategory = new Map<string, string>();
  for (const cat of categoryOrder) {
    aliasToCategory.set(norm(cat), cat);
    for (const alias of cfg.categories[cat] ?? []) {
      aliasToCategory.set(norm(alias), cat);
    }
  }

  // parse conventional commit
  let type: string | undefined;
  let scope: string | undefined;
  let bang = false;
  const m = CC_RE.exec(title);
  if (m) {
    type = norm(m[1]);
    scope = m[2];
    bang = !!m[3];
  }

  // breaking?
  let breaking = bang;
  const lowerTitle = norm(title);
  if (!breaking && cfg.breakingLabels?.length) {
    const breaks = cfg.breakingLabels.map(norm);
    const normed = new Set(labels.map((l) => normalizeLabel(l)));
    for (const lab of normed) {
      if (breaks.includes(lab) || lab === "breaking") {
        breaking = true;
        break;
      }
    }
  }
  if (!breaking && BREAKING_TOKENS.some((tok) => lowerTitle.includes(tok))) {
    breaking = true;
  }

  // 1) Match kategori via labels (etter normalisering)
  const normedLabels = labels.map(normalizeLabel);
  for (const cat of categoryOrder) {
    const aliases = (cfg.categories[cat] ?? []).map(norm);
    // tillat også match på selve kategorinavnet
    if (normedLabels.includes(norm(cat))) {
      return { category: cat, breaking, scope };
    }
    for (const lab of normedLabels) {
      if (aliases.includes(lab)) {
        return { category: cat, breaking, scope };
      }
    }
  }

  // 2) Match via CC type
  if (type && aliasToCategory.has(type)) {
    return { category: aliasToCategory.get(type)!, breaking, scope };
  }

  // 3) Fallbacks
  const FALLBACKS = [
    // norsk/engelsk navn i prioritert rekkefølge
    "Nytt",
    "Features",
    "Fikser",
    "Fixes",
    "Diverse",
    "Chores",
    "Misc",
  ];
  const fallback = FALLBACKS.find((f) => categoryOrder.includes(f));
  const category = fallback ?? categoryOrder[0] ?? "Changes";

  return { category, breaking, scope };
}
