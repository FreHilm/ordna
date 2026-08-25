# Releasing Ordna

How to publish a new version of `@frehilm/ordna-core`, `@frehilm/ordna-cli`,
and `@frehilm/ordna-web` to npm. All three packages are versioned and
released together, from `main`, manually.

## 0. Preconditions

- On `main`, clean working tree, all work committed **and pushed**.
- Logged in to npm: `npm whoami` should print your username
  (otherwise `npm login`).
- Decide the version: pre-1.0 semver as practiced here —
  **minor** (`0.X.0`) for new features, **patch** (`0.x.Y`) for fixes only.

## 1. Bump the version

Set the same `"version"` in all three package manifests:

- `packages/core/package.json`
- `packages/cli/package.json`
- `packages/web/package.json`

(The internal dependencies use `workspace:^` and are **not** edited — see
the pitfall in step 4.)

## 2. Verify the build

```bash
pnpm install          # make sure the lockfile is in sync
pnpm -r build
pnpm -r test
```

All packages must build and every test must pass before tagging.

## 3. Commit, tag, push

One release commit and a tag, matching the existing convention
(`git log --oneline | grep release:` / `git tag`):

```bash
git commit -am "release: X.Y.Z"
git tag X.Y.Z            # no v-prefix (convention since 0.1.3)
git push && git push --tags
```

## 4. Publish — with pnpm, never npm

```bash
pnpm -r publish
```

> **Why pnpm is mandatory:** the CLI depends on core and web via the
> `workspace:^` protocol. `pnpm publish` rewrites those to real ranges
> (`^X.Y.Z`) inside the published tarball. `npm publish` would ship the
> literal string `workspace:^`, breaking every install.

`pnpm publish` also refuses to run from a dirty tree or a branch other
than `main` — if it complains, fix that instead of forcing.

The stale `packages/jira` / `linear` / `mock-provider` / `ref-provider`
directories have no `package.json` and are ignored by `pnpm -r publish`.

## 5. Sanity-check the published result

```bash
npm view @frehilm/ordna-cli version     # → X.Y.Z
npm view @frehilm/ordna-cli dependencies # workspace:^ must NOT appear

# Real-world smoke test in a scratch directory:
mkdir -p /tmp/ordna-release-check && cd /tmp/ordna-release-check
npm i -g @frehilm/ordna-cli
ordna init && ordna create "Release smoke test" && ordna list
ordna web --no-open    # Ctrl-C after confirming it serves
```

## Known quirks

- `ordna --version` currently prints `0.0.0` — the version string is
  hardcoded in `buildProgram()` (`packages/cli/src/cli.ts`) rather than
  read from `package.json`. Fix it during a release if it bothers you.
- There is no CI publish pipeline — this whole flow is local and manual.
