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
const UNRELEASED_RE = /^## \[Unreleased\]\s*$/m;
const SECTION_CAPTURE_RE = /(## \[Unreleased\]\s*\n)([\s\S]*?)(?=^## \[|\Z)/m; // capture header + content

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

function ensureHeaderAndUnreleased(text: string): string {
  let t = text;
  if (!t.trim()) t = HEADER;
  if (!/^\#\s*Changelog/m.test(t)) {
    t = HEADER + t;
  }
  if (!UNRELEASED_RE.test(t)) {
    const idx = t.indexOf("\n## ");
    if (idx >= 0) {
      t = t.slice(0, idx) + "\n## [Unreleased]\n\n" + t.slice(idx);
    } else {
      t += "\n## [Unreleased]\n\n";
    }
  }
  t = t.replace(SECTION_CAPTURE_RE, (_m, hdr, body) => {
    const normBody = body.endsWith("\n") ? body : body + "\n";
    return `${hdr}${normBody}`;
  });
  return t;
}

function normalizeTitleForBullet(title: string): string {
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

  let catStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === categoryHeader.trim().toLowerCase()) {
      catStart = i;
      break;
    }
  }

  if (catStart === -1) {
    const trimmed = unreleasedBody.replace(/\s+$/s, "");
    const suffix = unreleasedBody.slice(trimmed.length); // bevar sluttlinjeskift
    const block = `${
      trimmed ? trimmed + "\n\n" : ""
    }${categoryHeader}\n${bullet}\n`;
    return block + suffix;
  }

  let insertAt = catStart + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;

  lines.splice(insertAt, 0, bullet);

  if (lines.length === 0 || lines[lines.length - 1] !== "") lines.push("");

  return lines.join("\n");
}

function replaceUnreleasedSection(
  fullText: string,
  updater: (body: string) => string
): string {
  if (!SECTION_CAPTURE_RE.test(fullText)) {
    const ensured = ensureHeaderAndUnreleased(fullText);
    return ensured.replace(SECTION_CAPTURE_RE, (_m, hdr, body) => {
      const updated = updater(body);
      return `${hdr}${updated}`;
    });
  }
  return fullText.replace(SECTION_CAPTURE_RE, (_m, hdr, body) => {
    const updated = updater(body);
    return `${hdr}${updated}`;
  });
}

// --- Public API ----------------------------------------------------------

export async function ensureChangelog(
  octo: Octokit,
  ctx: Context,
  cfg: Config
): Promise<FileData> {
  const { owner, repo } = ctx.repo;
  const branch = await getDefaultBranch(octo, owner, repo);
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

  // Sikre at header/Unreleased finnes
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
  const branch = await getDefaultBranch(octo, owner, repo);

  const file = await getFile(octo, owner, repo, path, branch);
  const base = file?.content ?? HEADER;

  // Sørg for at Unreleased finnes, og sett inn bullet
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
  const branch = await getDefaultBranch(octo, owner, repo);

  const file = await getFile(octo, owner, repo, path, branch);
  if (!file) return; // Ingen changelog å oppdatere

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Hent tag/versjon fra release-event
  const tag = (ctx.payload as any)?.release?.tag_name ?? "";
  const version = tag.replace(/^v/i, "") || "0.0.0";
  const versionHeader = `## [${version}] – ${dateStr}\n`;

  let unreleasedBody = "";
  const hasSection = SECTION_CAPTURE_RE.test(file.content);

  if (hasSection) {
    const m = SECTION_CAPTURE_RE.exec(file.content);
    unreleasedBody = (m?.[2] ?? "").trim();
  } else {
    // ingen Unreleased — ingenting å flytte
    return;
  }

  if (!unreleasedBody || unreleasedBody.replace(/\s+/g, "") === "") {
    // Tom Unreleased — ikke gjør noe
    return;
  }

  // Sett Unreleased tom og legg inn ny versjonsseksjon rett under Unreleased
  const next = file.content.replace(SECTION_CAPTURE_RE, (_m, hdr, body) => {
    // Fjern ekstra tomrom i enden av body
    const cleanBody = body.trimEnd();
    const newTop =
      `${hdr}\n` + // behold Unreleased header + en blank linje
      `${versionHeader}${cleanBody}\n\n`;
    return newTop;
  });

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

  // Oppdater GitHub Release body med samme tekst (uten versjonsheader)
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
