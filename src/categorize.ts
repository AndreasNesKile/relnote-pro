import type { Config } from "./config.js";

export type CategorizeResult = {
  category: string;
  breaking: boolean;
  scope?: string;
};

// Conventional Commits: type(scope)!: subject
const CC_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;

// Phrases in PR titles that indicate breaking changes
const BREAKING_TOKENS = [
  "breaking change",
  "breaking changes",
  "breaking-change",
  "breaking",
];

// Common label aliases → normalized short types
const COMMON_LABEL_ALIASES: Record<string, string> = {
  // features
  "type: feat": "feat",
  "type: feature": "feat",
  enhancement: "feat",
  feature: "feat",
  feat: "feat",

  // fixes
  "type: fix": "fix",
  bug: "fix",
  bugfix: "fix",
  hotfix: "fix",
  fix: "fix",

  // docs
  docs: "docs",
  documentation: "docs",

  // performance
  perf: "perf",
  performance: "perf",

  // refactor
  refactor: "refactor",
  refactoring: "refactor",

  // tests
  test: "test",
  tests: "test",

  // chores/maintenance
  chore: "chore",
  maintenance: "chore",
};

const norm = (s: string) => s.trim().toLowerCase();

function normalizeLabel(l: string): string {
  const n = norm(l);
  // Strip common prefixes like "type:" or "kind:"
  const stripped = n.replace(/^type:\s*/, "").replace(/^kind:\s*/, "");
  return COMMON_LABEL_ALIASES[stripped] ?? COMMON_LABEL_ALIASES[n] ?? stripped;
}

export function categorize(
  title: string,
  labels: string[] = [],
  cfg: Config
): CategorizeResult {
  const categoryOrder = Object.keys(cfg.categories ?? {});
  const aliasToCategory = new Map<string, string>();

  // Build alias → configured category map (English-only categories expected in cfg)
  for (const cat of categoryOrder) {
    aliasToCategory.set(norm(cat), cat);
    for (const alias of cfg.categories[cat] ?? []) {
      aliasToCategory.set(norm(alias), cat);
    }
  }

  // Parse Conventional Commit title
  let type: string | undefined;
  let scope: string | undefined;
  let bang = false;
  const m = CC_RE.exec(title);
  if (m) {
    type = norm(m[1]);
    scope = m[2];
    bang = !!m[3];
  }

  // Determine "breaking"
  let breaking = bang;
  const lowerTitle = norm(title);

  if (!breaking && cfg.breakingLabels?.length) {
    const breaks = cfg.breakingLabels.map(norm);
    const normed = new Set(labels.map((l) => normalizeLabel(l)));
    for (const lab of normed) {
      if (
        breaks.includes(lab) ||
        lab === "breaking" ||
        lab === "breaking-change"
      ) {
        breaking = true;
        break;
      }
    }
  }
  if (!breaking && BREAKING_TOKENS.some((tok) => lowerTitle.includes(tok))) {
    breaking = true;
  }

  // 1) Match via labels against configured categories/aliases
  const normedLabels = labels.map(normalizeLabel);
  for (const cat of categoryOrder) {
    const aliases = (cfg.categories[cat] ?? []).map(norm);
    if (normedLabels.includes(norm(cat))) {
      return { category: cat, breaking, scope };
    }
    for (const lab of normedLabels) {
      if (aliases.includes(lab)) {
        return { category: cat, breaking, scope };
      }
    }
  }

  // 2) Match via Conventional Commit type
  if (type && aliasToCategory.has(type)) {
    return { category: aliasToCategory.get(type)!, breaking, scope };
  }

  // 3) English-only fallbacks (pick the first one that exists in cfg)
  const FALLBACKS = [
    "Features",
    "Fixes",
    "Docs",
    "Performance",
    "Refactor",
    "Tests",
    "Chores",
    "Misc",
  ];
  const fallback = FALLBACKS.find((f) => categoryOrder.includes(f));
  const category = fallback ?? categoryOrder[0] ?? "Changes";

  return { category, breaking, scope };
}
