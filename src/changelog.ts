import { Context } from "@actions/github/lib/context";
import * as github from "@actions/github";
type Octokit = ReturnType<typeof github.getOctokit>;
import type { Config } from "./config.js";

const HEADER = `# Changelog
All notable changes to this project will be documented in this file.

## [Unreleased]

`;

// --- Utils ---------------------------------------------------------------

const ENC = "utf8";

// Accept "## [Unreleased]" or "## Unreleased" (case-insensitive)
const UNRELEASED_HEADER_RE = /^##\s*\[?\s*unreleased\s*\]?\s*$/im;

type FileData = { sha: string; content: string; branch: string };

function b64enc(s: string) {
  return Buffer.from(s, ENC).toString("base64");
}
function b64dec(s: string) {
  return Buffer.from(s, "base64").toString(ENC);
}

async function getDefaultBranch(
  octo: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const { data } = await octo.rest.repos.get({ owner, repo });
  return data.default_branch;
}

/** Prefer PR base or Release target; otherwise fallback (default branch). */
function resolveTargetBranch(ctx: Context, fallback: string): string {
  const prBase = (ctx.payload as any)?.pull_request?.base?.ref;
  const relTarget = (ctx.payload as any)?.release?.target_commitish;
  return prBase || relTarget || fallback;
}

async function getFile(
  octo: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ sha: string; content: string } | null> {
  try {
    const res = await octo.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (
      !Array.isArray(res.data) &&
      "type" in res.data &&
      res.data.type === "file"
    ) {
      const sha = res.data.sha!;
      const content = b64dec((res.data as any).content || "");
      return { sha, content };
    }
    return null;
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function putFile(
  octo: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  message: string,
  sha?: string
) {
  await octo.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message,
    content: b64enc(content),
    sha,
  });
}

function captureUnreleased(text: string) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (UNRELEASED_HEADER_RE.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return { start: -1, end: -1, header: "", body: "", lines };

  // find next "## " header
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const header = lines[start];
  const body = lines.slice(start + 1, end).join("\n");
  return { start, end, header, body, lines };
}

function ensureHeaderAndUnreleased(text: string): string {
  let t = text || "";
  if (!/^\#\s*Changelog/im.test(t)) {
    t = HEADER + t;
  }
  if (!UNRELEASED_HEADER_RE.test(t)) {
    // Insert Unreleased as the first section after the intro
    const idx = t.indexOf("\n## ");
    if (idx >= 0) t = t.slice(0, idx) + "\n## [Unreleased]\n\n" + t.slice(idx);
    else t += "\n## [Unreleased]\n\n";
  }
  return t;
}

function normalizeTitleForBullet(title: string): string {
  // Strip conventional commit prefix: type(scope)!: subject
  const m = /^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/.exec(title.trim());
  return m ? m[2] : title.trim();
}

function formatBullet(title: string, prNumber: number, scope?: string): string {
  const t = normalizeTitleForBullet(title);
  const scopePrefix = scope ? `[${scope}] ` : "";
  return `- ${scopePrefix}${t} (#${prNumber})`;
}

function catHeader(category: unknown): string {
  if (typeof category !== "string")
    throw new Error(`category must be string; got ${typeof category}`);
  return `### ${category}`;
}

function insertIntoUnreleasedCategory(
  unreleasedBody: string,
  category: string,
  bullet: string
): string {
  const categoryHeader = catHeader(category);
  const lines = unreleasedBody.split("\n");

  // Find existing category header (case-insensitive)
  let catStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === categoryHeader.trim().toLowerCase()) {
      catStart = i;
      break;
    }
  }

  if (catStart === -1) {
    // Create category section at the end of Unreleased body
    const trimmed = unreleasedBody.replace(/\s+$/s, "");
    const suffix = unreleasedBody.slice(trimmed.length);
    const block = `${
      trimmed ? trimmed + "\n\n" : ""
    }${categoryHeader}\n${bullet}\n`;
    return block + suffix;
  }

  // Insert bullet right after the category header (skip blank lines)
  let insertAt = catStart + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;
  lines.splice(insertAt, 0, bullet);

  // Ensure there is a trailing newline
  if (lines.length === 0 || lines[lines.length - 1] !== "") lines.push("");

  return lines.join("\n");
}

function replaceUnreleasedSection(
  fullText: string,
  updater: (body: string) => string
): string {
  const t = ensureHeaderAndUnreleased(fullText);
  const cap = captureUnreleased(t);
  if (cap.start === -1) return t; // shouldn't happen after ensure
  const updatedBody = updater(cap.body);
  const before = cap.lines.slice(0, cap.start + 1).join("\n");
  const after = cap.lines.slice(cap.end).join("\n");
  // Normalize extra blank lines
  return [before, updatedBody.trimEnd(), "", after]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// --- Public API ----------------------------------------------------------

export async function ensureChangelog(
  octo: Octokit,
  ctx: Context,
  cfg: Config
): Promise<FileData> {
  const { owner, repo } = ctx.repo;
  const defaultBranch = await getDefaultBranch(octo, owner, repo);
  const branch = resolveTargetBranch(ctx, defaultBranch);
  const path = cfg.changelogPath ?? "CHANGELOG.md";

  const existing = await getFile(octo, owner, repo, path, branch);
  if (!existing) {
    await putFile(
      octo,
      owner,
      repo,
      path,
      branch,
      HEADER,
      "chore(relnote): initialize CHANGELOG.md"
    );
    const fresh = await getFile(octo, owner, repo, path, branch);
    if (!fresh) throw new Error("Failed to create CHANGELOG.md");
    return { sha: fresh.sha, content: fresh.content, branch };
  }

  const ensured = ensureHeaderAndUnreleased(existing.content);
  if (ensured !== existing.content) {
    await putFile(
      octo,
      owner,
      repo,
      path,
      branch,
      ensured,
      "chore(relnote): ensure Unreleased section",
      existing.sha
    );
    const updated = await getFile(octo, owner, repo, path, branch);
    if (!updated) throw new Error("Failed to update CHANGELOG.md");
    return { sha: updated.sha, content: updated.content, branch };
  }

  return { sha: existing.sha, content: existing.content, branch };
}

export async function addUnreleasedEntry(
  octo: Octokit,
  ctx: Context,
  cfg: Config,
  entry: { prNumber: number; title: string; category: string; scope?: string }
) {
  const { owner, repo } = ctx.repo;
  const path = cfg.changelogPath ?? "CHANGELOG.md";
  const defaultBranch = await getDefaultBranch(octo, owner, repo);
  const branch = resolveTargetBranch(ctx, defaultBranch);

  const file = await getFile(octo, owner, repo, path, branch);
  const base = file?.content ?? HEADER;

  const next = replaceUnreleasedSection(
    ensureHeaderAndUnreleased(base),
    (body) =>
      insertIntoUnreleasedCategory(
        body,
        entry.category,
        formatBullet(entry.title, entry.prNumber, entry.scope)
      )
  );

  await putFile(
    octo,
    owner,
    repo,
    path,
    branch,
    next,
    `chore(relnote): add PR #${entry.prNumber} to Unreleased`,
    file?.sha
  );
}

export async function releaseUnreleased(
  octo: Octokit,
  ctx: Context,
  cfg: Config
) {
  const { owner, repo } = ctx.repo;
  const path = cfg.changelogPath ?? "CHANGELOG.md";
  const defaultBranch = await getDefaultBranch(octo, owner, repo);
  const branch = resolveTargetBranch(ctx, defaultBranch);

  const file = await getFile(octo, owner, repo, path, branch);
  if (!file) return; // no changelog to update

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Pull version tag from the release event
  const tag = (ctx.payload as any)?.release?.tag_name ?? "";
  const version = tag.replace(/^v/i, "") || "0.0.0";
  const versionHeader = `## [${version}] – ${dateStr}\n`;

  // Extract Unreleased section body
  const cap = captureUnreleased(file.content);
  const unreleasedBody = cap.body.trim();
  if (!unreleasedBody) return; // nothing to move

  // Move Unreleased → versioned section, keep Unreleased header in place
  const next = (() => {
    const before = cap.lines.slice(0, cap.start + 1).join("\n");
    const after = cap.lines.slice(cap.end).join("\n");
    const cleanBody = unreleasedBody.trimEnd();
    // Insert version section right after Unreleased header; keep Unreleased empty for future entries
    return [before, "", `${versionHeader}${cleanBody}\n`, after]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  })();

  await putFile(
    octo,
    owner,
    repo,
    path,
    branch,
    next,
    `chore(relnote): release ${version}`,
    file.sha
  );

  // Mirror in the GitHub Release body
  const releaseId = (ctx.payload as any)?.release?.id as number | undefined;
  if (releaseId) {
    await octo.rest.repos.updateRelease({
      owner,
      repo,
      release_id: releaseId,
      body: `${unreleasedBody}\n`,
    });
  }
}
