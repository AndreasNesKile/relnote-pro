# RelNote Pro

Automatic, clean, and consistent changelogs & release notes — monorepo-friendly, with SemVer suggestions and Keep a Changelog–style output. Ships as a GitHub Action; consumers don’t need Node, pnpm, or build steps.

> **TL;DR**  
> Merge a PR → a bullet is added under `## [Unreleased]`.  
> Publish a GitHub Release → Unreleased moves to `## [x.y.z] – YYYY-MM-DD` and becomes the release body.

---

## Features

- **PR ➜ Unreleased**: On PR **merge**, adds a bullet to `CHANGELOG.md` under the configured category.
- **Categorization**: Uses labels and/or Conventional Commits (`feat:`, `fix:`, `docs:` …).
- **SemVer suggestion**: Exposes `bump = major | minor | patch | none` (breaking label or `!` ⇒ major).
- **Monorepo support**: Optional workspace detection for pnpm/yarn/npm workspaces; can infer a `[scope]`.
- **Release sync**: On **release published**, moves Unreleased into a new version section and sets the release body.
- **Zero external calls**: Uses GitHub APIs only. No data leaves GitHub.

---

## How it works

- **PR merged** (event: `pull_request.closed` with `merged=true`):  
  Adds an entry to `CHANGELOG.md → ## [Unreleased] → ### <Category>` on the **PR’s base branch** (e.g., `dev` or `master`).
- **Release published** (event: `release.published`):  
  Moves the Unreleased contents to a new section `## [x.y.z] – YYYY-MM-DD` on the **release target branch**, and sets the release body.

---

## Quick Start (consumer repo)

1. **Add the workflow** (use `@v0` or pin to a specific tag like `@v0.1.4`):

```yaml
# .github/workflows/relnote-pro.yml
name: RelNote Pro
on:
  pull_request:
    types: [closed]
  release:
    types: [published]

permissions:
  contents: write
  pull-requests: read
  issues: read

jobs:
  relnotes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: RelNote Pro
        uses: relnotepro/relnote-pro@v0 # or @v0.1.4
        env:
          GITHUB_TOKEN: ${{ github.token }}
        with:
          config-path: ".relnote-pro.yml"
```

2. **Optional config** (English-only). Create `.relnote-pro.yml` at repo root:

```yaml
changelogPath: CHANGELOG.md
language: en
categories:
  Features: ["feature", "feat", "enhancement"]
  Fixes: ["fix", "bug"]
  Docs: ["docs"]
  Performance: ["perf"]
  Refactor: ["refactor"]
  Tests: ["test"]
  Chores: ["chore"]
breakingLabels: ["breaking", "breaking-change", "major"]
monorepo:
  enabled: true
  detect: true
  packages:
    - "packages/*"
```

3. **Merge a PR** with a CC title (e.g., `fix: clamp invalid question number`) → see `CHANGELOG.md → ## [Unreleased]`.
4. **Publish a Release** (e.g., tag `v0.1.0`) → Unreleased moves to `## [0.1.0] – YYYY-MM-DD` and becomes the release body.

> **Important:** The workflow file must exist on the **PR base branch** before you merge. If `dev` is the base, ensure the workflow is on `dev`.

---

## Example output

```md
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- Add user export endpoint (#23)

### Fixes

- Clamp invalid question number (#55)
```

---

## Labels & titles

- Prefer **Conventional Commits** titles: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`.
- Or apply labels that map to your categories (see `.relnote-pro.yml`).
- Mark breaking changes with the `!` in the title (`feat!: ...`) or a label from `breakingLabels`.

---

## Monorepo scope (optional)

If `monorepo.enabled: true`, the action can infer a `[scope]` from changed files (e.g., the workspace package name) and prefix bullets like:

- [api] Add rate limiting (#123)

It will auto-detect workspaces from:

- `package.json` → `workspaces` or `workspaces.packages`
- `pnpm-workspace.yaml` → `packages:`

You can override with explicit `monorepo.packages` globs.

---

## Permissions & branch protection

- The job needs:
  ```yaml
  permissions:
    contents: write
    pull-requests: read
    issues: read
  ```
- On **protected branches**, enable **Allow GitHub Actions to push** so it can update `CHANGELOG.md`.

---

## Troubleshooting

- **No changelog update after merge**

  - Workflow wasn’t on the PR base branch at merge time → add it and merge a new PR.
  - You’re using an old tag → use `relnotepro/relnote-pro@v0` (or latest pinned tag).
  - Branch protection blocked bot commits → allow Actions to push.
  - Looking at the wrong file path → set `changelogPath` or use the default `CHANGELOG.md`.

- **Action failed with ESM/CJS error**

  - Use a tag that ships a CommonJS bundle (e.g., `@v0.1.4` or `@v0`).

- **Release didn’t move Unreleased**

  - Ensure the workflow includes `release: { types: [published] }` and there’s content in Unreleased.

- **Quick manual test (no PR)**
  - Add this temporary **smoke** workflow and run it from Actions:
    ```yaml
    name: RelNote Pro - smoke
    on: { workflow_dispatch: {} }
    permissions: { contents: write, pull-requests: read, issues: read }
    jobs:
      t:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - name: RelNote Pro
            id: relnote
            uses: relnotepro/relnote-pro@v0
            env: { GITHUB_TOKEN: ${{ github.token }} }
            with: { config-path: ".relnote-pro.yml" }
          - name: Show bump suggestion
            run: echo "SemVer bump => ${{ steps.relnote.outputs.bump }}"
    ```

---

## Development (action maintainers)

- pnpm is used for install/build. Consumers do not need pnpm.
- Source is ESM TS; build outputs a CommonJS bundle at `dist/index.cjs`.

**`package.json` (key parts)**

```json
{
  "packageManager": "pnpm@9",
  "type": "module",
  "main": "dist/index.cjs",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/index.cjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepare": "pnpm build"
  }
}
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**CI (ensures `dist/` is committed)**

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm i --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - name: Ensure dist is committed
        run: |
          git diff --exit-code --name-only dist || \
          (echo "::error::dist/ changed — commit build output" && exit 1)
```

**Tag & alias**

```bash
git tag v0.1.4 && git push origin v0.1.4
git tag -f v0 && git push -f origin v0
```

---

## License

MIT © RelNote Pro
