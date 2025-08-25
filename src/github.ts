import * as github from "@actions/github";
type Octokit = ReturnType<typeof github.getOctokit>;

/** Get PR number from context if present. */
export function getPrNumberFromContext(): number | undefined {
  const n = (github.context.payload as any)?.pull_request?.number;
  return typeof n === "number" ? n : undefined;
}

/** Get PR base branch (e.g., "dev" or "master") if present. */
export function getPrBaseRefFromContext(): string | undefined {
  return (github.context.payload as any)?.pull_request?.base?.ref;
}

/** List changed files (paths) for a PR. */
export async function listPrFiles(
  octo: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<
  Array<{
    filename: string;
    previous_filename?: string;
    status: "added" | "modified" | "removed" | "renamed" | "changed";
  }>
> {
  const files: Array<{
    filename: string;
    previous_filename?: string;
    status: "added" | "modified" | "removed" | "renamed" | "changed";
  }> = [];

  let page = 1;
  for (;;) {
    const { data } = await octo.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    for (const f of data) {
      files.push({
        filename: f.filename,
        previous_filename: (f as any).previous_filename,
        status:
          (f.status as any) === "changed" || (f.status as any) === "modified"
            ? "modified"
            : (f.status as any),
      });
    }
    if (data.length < 100) break;
    page++;
  }
  return files;
}

/** Read a UTF-8 text file from the repo at a given ref/branch. */
export async function readTextFileFromRepo(
  octo: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const res = await octo.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(res.data)) return null;
    if ("type" in res.data && res.data.type === "file") {
      const content = Buffer.from(
        (res.data as any).content || "",
        "base64"
      ).toString("utf8");
      return content;
    }
    return null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** Fetch the recursive git tree (list of paths) for a ref. */
export async function listRepoTreePaths(
  octo: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<string[]> {
  // Get the commit SHA for the ref
  const refInfo = await octo.rest.git.getRef({
    owner,
    repo,
    ref: ref.startsWith("refs/") ? ref.replace(/^refs\//, "") : `heads/${ref}`,
  });
  const commitSha = refInfo.data.object.sha;

  const tree = await octo.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  const paths: string[] = [];
  for (const item of tree.data.tree) {
    if (item.path) paths.push(item.path);
  }
  return paths;
}
