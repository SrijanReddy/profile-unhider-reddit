# Contributing

## Workflow

AI agents: read `AGENTS.md` at the repo root first — it states the
workflow rules that apply to any agent working in this repo.

1. Branch from `main` (`fix/<short-name>` or `reorg/<short-name>`).
2. Open a PR against `main`. The maintainer merges — PRs are never merged
   by the author.
3. Keep PRs focused: one change, one PR. A reorg PR changes no behaviour;
   a behaviour PR changes no structure it doesn't need.
4. Ask before setting git commit authorship. Never default to the
   maintainer's name.

## Testing (unpacked)

There is no test suite. Test by loading the extension unpacked:

```
chrome://extensions → Developer mode → Load unpacked → select extension/
```

Checklist for a content-script change:

- Open a hidden profile on reddit.com — the panel injects, Posts and
  Comments load, Insights renders.
- Same on old.reddit.com.
- Hover a username anywhere — the badge shows hidden/public.
- Open the toolbar popup on a profile page and off Reddit — status and
  stats read correctly.
- Reload an already-open Reddit tab after updating the extension — no
  errors in `chrome://extensions` (see "Stale tabs" in ARCHITECTURE.md).

For a popup-only change, the popup can be reloaded by closing and reopening
it; for a content-script change, reload the Reddit tab too.

## Release checklist

1. Bump `version` in `extension/manifest.json`.
2. Add the version's entry to `extension/whats-new.json` (this is what the
   popup shows after an update).
3. Add the version to `CHANGELOG.md` and to the site's "What's new"
   section in `website/index.html`.
4. Test unpacked with the checklist above.
5. Zip only the extension folder:
   `cd extension && zip -r ../profile-unhider.zip . -x '*.DS_Store'`
   (or `npm run zip`).
6. Upload the zip to the Chrome Web Store, and the new version to AMO for
   Firefox. After `main` moves, re-sync the `firefox` branch (see
   ARCHITECTURE.md) — AMO does not pick it up on its own.

## Code style

- Two-space indent, double quotes, semicolons. `.prettierrc` and
  `.editorconfig` encode this; run `npx prettier --write extension website`
  before opening a PR (requires `npm install` once for the dev dependency).
- No build step, no modules in the extension: plain classic scripts, one
  global scope for the content script (see ARCHITECTURE.md for the rules
  that keeps it safe).
- `npm run check` runs `node --check` over every extension JS file.
  Keep it green.

## Workflows

CI lives in `.github/workflows/`. Two are planned: an extension sanity
check (syntax, manifest, file lists) and a version-bump guard (extension
code changed ⇒ version bumped, and a whats-new entry to match). Reorg-only
PRs change extension files without a release, so the guard needs an
exemption (or a patch bump) for those.
