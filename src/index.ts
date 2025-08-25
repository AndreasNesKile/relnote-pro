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
    await ensureChangelog(octo, ctx, cfg);

    const labels = (pr.labels ?? []).map((l: any) =>
      typeof l === "string" ? l : l.name
    );
    const res: CategorizeResult = categorize(pr.title, labels, cfg);

    assertString("res.category", res.category);

    await addUnreleasedEntry(octo, ctx, cfg, {
      prNumber: pr.number,
      title: pr.title,
      category: res.category, // ✅ bare streng
      scope: res.scope,
    });

    core.setOutput("bump", suggestBump(res));
    core.info(
      `RelNote Pro: PR #${pr.number} → category="${res.category}" scope="${
        res.scope ?? ""
      }"`
    );
  }

  if (ctx.eventName === "release" && ctx.payload.action === "published") {
    await releaseUnreleased(octo, ctx, cfg);
  }
}

run().catch((err) =>
  core.setFailed(err instanceof Error ? err.message : String(err))
);
