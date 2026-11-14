# AGENTS.md

Instructions for AI agents working in this repo. Short on purpose: the
technical detail lives in `docs/ARCHITECTURE.md` and
`docs/CONTRIBUTING.md`. Read those before changing extension code.

## Workflow

- Work on a branch, open a PR against `main`. Never push to `main`.
- Never merge a PR yourself. The maintainer merges.
- Ask before setting git commit authorship. Never default to the
  maintainer's name.
- Before claiming a push landed, verify it on the remote with
  `git ls-remote` or `git log` on the remote branch. A reported push
  success can silently not apply.
- Discuss the direction before building visible UI. Build a visual
  preview (or a spec when the change is not visible) and get validation
  before opening the PR.

## GitHub limits

- The Muse GitHub App has no Workflows permission, so pushing
  `.github/workflows/` files fails with 403. The maintainer pastes
  workflow files through the GitHub web UI instead.
- Never push binary files (PNG, TTF, zip) through the GitHub API: it
  treats file content as UTF-8 text and corrupts them. Use the web UI.
- The connector has no branch-delete tool and no merge tool. Hand the
  maintainer the step instead.

## Repo layout

- `extension/` is the extension, loaded unpacked and zipped for the
  stores. No build step, no bundler, plain classic scripts.
- The content script is split: `extension/content/` holds one file per
  layer (config, utils, state, detection, api, renderers, panel,
  entry), `extension/shared/` holds helpers used by more than one
  context. `manifest.json` lists the files in load order; they share
  one global scope, no imports.
- Never add a top-level name that already exists in another
  content-script file, including `hovercard.js`. A duplicate `const`
  or `let` breaks the whole script.
- Verify with `npm run check` (syntax plus every file the manifest
  lists must exist) and `npm run zip` before opening a PR.

## Ground rules

- Reddit's own search is dead. `search.json?q=author:` returns
  "blocked by network security" even when logged in (verified
  2026-11-03). Posts and comments come from the Arctic Shift and
  PullPush public archives only. Do not rebuild the Posts tab on
  Reddit search.
- Every version bump needs a matching entry in
  `extension/whats-new.json`, or the popup shows no What's new on
  update. Version 4.0 has no entry (the tags item sits under 3.5.0).
- Never claim something was tested in Chrome unless it actually was.
  Unpacked Chrome testing is the maintainer's job.
- Do not rebuild the Posts tab archive fallback until the maintainer
  answers the three open questions (source order, cap, release
  vehicle). Ask him; do not guess.

## Voice

- No em dashes in user-facing copy. Keep the maintainer's wording;
  minimal cleanup only, never polish it into generic marketing copy.

## Privacy

- Never surface the Trello board email from `website/app.js`. It is
  in the repo source for the support form, not for sharing.
- The extension collects no personal data and runs no analytics.
  Settings and counters live in local browser storage only.
