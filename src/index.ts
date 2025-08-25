import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config.js";
import {
  ensureChangelog,
  addUnreleasedEntry,
  releaseUnreleased,
} from "./changelog.js";
import { categorize, type CategorizeResult } from "./categorize.js";
import { suggestBump } from "./semver.js";
import { detectScopeForCurrentPr } from "./monorepo.js";

function assertString(name: string, v: unknown): asserts v is string {
  if (typeof v !== "string")
    throw new Error(`${name} must be a string; got ${typeof v}`);
}

async function run() {
  const ctx = github.context;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN missing");

  const octo = github.getOctokit(token);
  const cfg = await loadConfig(core.getInput("config-path"));

  if (
    ctx.eventName === "pull_request" &&
    ctx.payload.action === "closed" &&
    ctx.payload.pull_request?.merged
  ) {
    const pr = ctx.payload.pull_request;

    // Figure out which branch/ref to inspect for workspace layout (usually PR base)
    const baseRef =
      (ctx.payload as any)?.pull_request?.base?.ref ||
      (
        await octo.rest.repos.get({
          owner: ctx.repo.owner,
          repo: ctx.repo.repo,
        })
      ).data.default_branch;

    // Try to infer scope from changed files if monorepo is enabled
    let inferredScope: string | undefined = undefined;
    if (cfg.monorepo?.enabled) {
      inferredScope = await detectScopeForCurrentPr(
        octo,
        ctx.repo.owner,
        ctx.repo.repo,
        baseRef,
        cfg.monorepo?.packages
      );
    }

    const res = categorize(
      pr.title,
      (pr.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      cfg
    );

    await addUnreleasedEntry(octo, ctx, cfg, {
      prNumber: pr.number,
      title: pr.title,
      category: res.category,
      scope: res.scope ?? inferredScope, // prefer CC scope; fall back to monorepo inference
    });

    core.setOutput("bump", suggestBump(res));
  }

  if (ctx.eventName === "release" && ctx.payload.action === "published") {
    await releaseUnreleased(octo, ctx, cfg);
  }
}

run().catch((err) =>
  core.setFailed(err instanceof Error ? err.message : String(err))
);
