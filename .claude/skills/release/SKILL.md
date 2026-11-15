---
name: release
description: Cut a release of dbt-sugar - collapse the spec into one fresh contract, bump semver from conventional commits, draft release notes, and verify. The user pushes, then creates the GitHub release, which creates the MAJOR.MINOR.PATCH tag (no v prefix), and publishes to npm.
---

# Release

1. **Start clean.** The working tree is clean, you're on `main`, and `main` is up to date with `origin/main`. If not, stop and say why.
2. **Collapse the spec into a fresh contract.**
   - Every accepted proposal in `docs/proposals/` should already be in `docs/spec.md`. Check that it is, then delete the proposal. Keep `0000-template.md` and any proposal still in Draft.
   - Remove pointers from the spec to proposals, and wording that tells history ("now", "no longer", "since 0002").
   - Re-read the whole spec once from the top. Split overlong bullets, and make sure the engineering loop and out-of-scope lists match `CONTRIBUTING.md` and `CLAUDE.md`.
   - Run the `spec-reviewer` subagent on `docs/spec.md` alone and fix every finding.
3. **Pick the version.** Run `git fetch --tags` (release tags are made on GitHub), then list the commits since the last tag: `git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline`.
   - `!` or `BREAKING` → major (minor while on `0.x`)
   - any `feat` → minor
   - otherwise → patch
4. **Draft the release notes** in a scratchpad file, not in the repo (there is no CHANGELOG; GitHub releases are the history). Use Features, Fixes and Quality sections, with one line per user-visible change in the spec's words and no commit hashes. Write them for people.
5. **Verify.**
   - Run `npm version <version> --no-git-tag-version`, then `/verify`, `npm run spec-guard` and `npm pack --dry-run`.
   - The tarball should list only `src/` (minus `src/scripts`), `LICENSE`, `README.md` and `package.json`.
6. **Commit.** Commit `chore(release): <version>`. Don't create a git tag: the GitHub release creates it.
   - Squash history only when the user asks. Before squashing, keep a local `backup/pre-squash` branch.
7. **Hand over.**
   - Tell the user to push `main`. Use `--force-with-lease` only after a squash they asked for.
   - Give the user the path of the notes file from step 4.
   - The user creates the GitHub release: Releases → Draft a new release → a new tag `<version>` (bare `MAJOR.MINOR.PATCH`, no `v`) on `main` → paste the notes. GitHub creates the tag then.
   - Never push, create a release or `npm publish` yourself unless the user says yes to that exact step.
