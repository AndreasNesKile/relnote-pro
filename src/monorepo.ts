import * as github from "@actions/github";
import yaml from "js-yaml";
import {
  readTextFileFromRepo,
  listRepoTreePaths,
  listPrFiles,
} from "./github.js";
type Octokit = ReturnType<typeof github.getOctokit>;

export type WorkspaceGlob = string;
export type PackageMeta = { dir: string; name?: string };

/** Convert a glob like "packages/*" or "apps/**" into a RegExp. Minimal implementation. */
function globToRegExp(glob: string): RegExp {
  // Escape regex specials, then bring back globs
  let g = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*\\\*/g, "__GLOBSTAR__")
    .replace(/\\\*/g, "__GLOB__");
  g = g.replace(/__GLOBSTAR__/g, ".*").replace(/__GLOB__/g, "[^/]*");
  // Anchor to full path
  return new RegExp("^" + g + "(?:/.*)?$");
}

/** Try to read Yarn/NPM workspaces from package.json (root). */
async function readWorkspacesFromPackageJson(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<WorkspaceGlob[] | null> {
  const pkgText = await readTextFileFromRepo(
    octo,
    owner,
    repo,
    "package.json",
    ref
  );
  if (!pkgText) return null;
  try {
    const pkg = JSON.parse(pkgText);
    if (Array.isArray(pkg.workspaces)) {
      return pkg.workspaces as string[];
    }
    if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      return pkg.workspaces.packages as string[];
    }
    return null;
  } catch {
    return null;
  }
}

/** Try to read pnpm workspaces from pnpm-workspace.yaml */
async function readWorkspacesFromPnpm(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<WorkspaceGlob[] | null> {
  const yml = await readTextFileFromRepo(
    octo,
    owner,
    repo,
    "pnpm-workspace.yaml",
    ref
  );
  if (!yml) return null;
  try {
    const data = yaml.load(yml) as any;
    const arr = data?.packages;
    if (Array.isArray(arr)) return arr as string[];
    return null;
  } catch {
    return null;
  }
}

/** Deduplicate & normalize workspace globs. */
function normalizeGlobs(globs: string[] | null | undefined): WorkspaceGlob[] {
  const set = new Set<string>();
  for (const g of globs ?? []) {
    if (typeof g === "string" && g.trim())
      set.add(g.trim().replace(/^\.\//, ""));
  }
  return [...set];
}

/** Detect workspace globs using (in order): config, root package.json, pnpm-workspace.yaml. */
export async function detectWorkspaceGlobs(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string,
  cfgGlobs?: string[]
): Promise<WorkspaceGlob[]> {
  // Prefer explicit config if provided
  const viaCfg = normalizeGlobs(cfgGlobs);
  if (viaCfg.length) return viaCfg;

  // Then try Yarn/NPM workspaces
  const viaPkg = normalizeGlobs(
    await readWorkspacesFromPackageJson(octo, owner, repo, ref)
  );
  if (viaPkg.length) return viaPkg;

  // Then pnpm
  const viaPnpm = normalizeGlobs(
    await readWorkspacesFromPnpm(octo, owner, repo, ref)
  );
  if (viaPnpm.length) return viaPnpm;

  return []; // not a monorepo or not configured
}

/** From a repo tree and workspace globs, return package directories that contain package.json. */
export async function listWorkspacePackages(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string,
  workspaceGlobs: WorkspaceGlob[]
): Promise<PackageMeta[]> {
  if (!workspaceGlobs.length) return [];
  const regexes = workspaceGlobs.map(globToRegExp);
  const allPaths = await listRepoTreePaths(octo, owner, repo, ref);

  // Candidate package.json files that match any workspace glob
  const pkgJsonPaths = allPaths.filter((p) => p.endsWith("/package.json"));
  const hits = pkgJsonPaths.filter((p) =>
    regexes.some((re) => re.test(p.replace(/\/package\.json$/, "")))
  );

  // Turn into package dirs and read names
  const metas: PackageMeta[] = [];
  for (const pkgPath of hits) {
    const dir = pkgPath.replace(/\/package\.json$/, "");
    let name: string | undefined;
    try {
      const text = await readTextFileFromRepo(octo, owner, repo, pkgPath, ref);
      if (text) {
        const pkg = JSON.parse(text);
        if (typeof pkg.name === "string" && pkg.name.trim())
          name = pkg.name.trim();
      }
    } catch {
      // ignore parse errors; keep dir only
    }
    metas.push({ dir, name });
  }
  return metas;
}

/** Given file paths changed in a PR and the known packages, infer a single scope if possible. */
export function inferScopeFromPaths(
  changedPaths: string[],
  packages: PackageMeta[]
): string | undefined {
  if (!changedPaths.length || !packages.length) return undefined;

  // Find all package dirs touched by this PR
  const touched: PackageMeta[] = [];
  for (const p of changedPaths) {
    const hit = packages
      .filter((pkg) => p === pkg.dir || p.startsWith(pkg.dir + "/"))
      // pick the most specific (longest dir) if multiple match
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (hit && !touched.some((t) => t.dir === hit.dir)) touched.push(hit);
  }

  if (touched.length === 1) {
    const only = touched[0];
    return only.name || only.dir.split("/").pop(); // prefer package name, fallback to folder
  }

  // Multiple packages or none → no single scope
  return undefined;
}

/** High-level helper: detect scope for the current PR using repo workspaces. */
export async function detectScopeForCurrentPr(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string,
  cfgGlobs?: string[]
): Promise<string | undefined> {
  const prNumber = (github.context.payload as any)?.pull_request?.number;
  if (!prNumber) return undefined;

  // List PR files
  const files = await listPrFiles(octo, owner, repo, prNumber);
  const changed = files.map((f) => f.filename);

  // Discover workspace globs and package metas
  const globs = await detectWorkspaceGlobs(octo, owner, repo, ref, cfgGlobs);
  if (!globs.length) return undefined;

  const pkgs = await listWorkspacePackages(octo, owner, repo, ref, globs);
  if (!pkgs.length) return undefined;

  return inferScopeFromPaths(changed, pkgs);
}
