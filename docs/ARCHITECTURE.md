# Architecture

> AI agents working in this repo: read `AGENTS.md` at the repo root
> first. It states the workflow rules; this file is the technical detail.

Profile Unhider is a Manifest V3 extension (Chrome + Firefox) plus a static
website. There is no build step and no bundler: the extension is plain
JavaScript and CSS loaded straight from `extension/`.

## Extension layout

```
extension/
  manifest.json          version, permissions, content-script file lists
  background.js          service worker: install seed, uninstall redirect
  hovercard.js           hover badges on usernames anywhere on Reddit
  popup.html / popup.js / popup.css
                         the toolbar popup
  whats-new.json         what's-new entries, keyed by version (popup shows these)
  icons/
  shared/
    storage.js           stale-tab-safe storageGet / storageSet
    format.js            formatCount: compact stat counts for the popup
  content/
    content.js           entry point: inject, pipeline, polling + SPA watcher
    config.js            which Reddit this is, the injected flag
    utils.js             esc, timeAgo, fmtScore, getUsername
    state.js             session state, theme, stats, rating nudge
    detection.js         finding hidden profiles + the fallback banner
    api.js               posts/comments fetching, archive servers, insights scan
    renderers.js         post/comment renderers + activity heatmap +
                       removed/deleted and NSFW labels and filters
    panel.js             the on-page panel
    panel.css            trigger wrap + panel shell
    panel-views.css      disclaimer, fallback banner, sort bar, insights
    panel-features.css   old Reddit tweaks, rating nudge, server row, heatmap,
                       removed/deleted labels and filter chips
```

## How the content script loads

`manifest.json` lists the content-script files in load order. They are
classic scripts, so they share one global scope: a function declared in
`utils.js` is callable from `api.js`, and a `const` declared in `config.js`
is visible in every file loaded after it. There are no imports.

Order matters only for code that runs at load time:

1. `shared/storage.js` — the storage guards, used by everything below.
2. `content/config.js` — `window.__rpuInjected`, `IS_OLD_REDDIT`, `ORIGIN`.
3. `content/utils.js` — pure helpers, no load-time side effects.
4. `content/state.js` — reads the stored theme at load; registers the
   `chrome.storage.onChanged` listener (guarded).
5. `content/detection.js`, `content/api.js`, `content/renderers.js`,
   `content/panel.js` — function and constant declarations only.
   (`panel.js` holds `buildPanel`; the panel's live behaviour — tabs,
   pipeline, SPA watching — lives in the entry file, `content.js`.)
6. `content/content.js` (entry, last) — starts the polling timer and the
   SPA `MutationObserver`, and registers the popup status listener.
7. `hovercard.js` — independent; shares the same isolated world but defines
   no names that collide with the files above.

Rules for editing:

- New code goes in the file for its layer. Don't add a new top-level name
  that already exists in another content-script file (including
  `hovercard.js`) — a duplicate `const`/`let` breaks the whole script.
- Don't put load-time calls in a file that depends on a later file. The
  entry point (`content/content.js`) is the only file that starts timers,
  observers, or listeners.
- The popup is a separate page context. It only shares code through
  `shared/` files listed in `popup.html` (`format.js` today). Popup ↔ page
  communication is `chrome.tabs.sendMessage({ type: "getStatus" })`, answered
  by the content script's `onMessage` listener.

## Data sources

Posts and comments come from public archives, not from Reddit:

- **Server 1** = Arctic Shift, **Server 2** = PullPush. Users only ever see
  "Server 1" / "Server 2", never the service names.
- Requests are strictly serialized with a 1.5s gap. A server that fails is
  put on cooldown and the other one is used; if both are busy the panel
  shows a friendly "a lot of traffic" error with a retry countdown.
- The archives only order by time, so sort/time filters are applied
  client-side.
- Insights reuses the posts/comments the tabs already fetched instead of
  running its own scan.

**Reddit's own search is dead.** `search.json?q=author:` returns "blocked by
network security" even when logged in (verified 2026-11-03; normal browsing
and `r/popular.json` still work). The commented-out `search.json` code in
`api.js` is the pre-2026-10-25 fallback, kept for reference. Do not rebuild
the Posts tab on it — the archive fallback is the live path.

## Two count formatters

Both exist on purpose, in different contexts:

- `fmtScore` (`content/utils.js`) — panel scores, `1.0k` style.
- `formatCount` (`shared/format.js`) — popup stats, `1.5k` style, full
  number on hover. Under 1,000 it stays exact.

## Stale tabs

Reloading or updating the extension leaves an already-injected content
script running in open tabs, but its `chrome.*` APIs go away
(`chrome.storage` becomes `undefined`). Every storage call in the content
script goes through `storageGet` / `storageSet` (`shared/storage.js`), which
fail silent in that state instead of throwing. After merging a fix like
that, already-open Reddit tabs must be reloaded once to pick up the new
script.

## Theme

The popup and the panel share one `"theme"` key in `chrome.storage`
(`"light"` / `"dark"`; unset follows the OS). The panel sets
`data-rpu-theme` on `<html>`; the popup sets `data-theme`. The CSS keys off
those attributes.

## Popup and background

- `popup.js` reads counts and the enabled flag from storage, asks the
  active tab for its status (`getStatus`), and shows the What's new view
  when `lastSeenVersion` differs from the current version.
- `background.js` seeds `lastSeenVersion` on install and points the
  uninstall URL at the website's `#goodbye` page with the version in the
  query string.

## Website

`website/` is a static site (Vercel, project root `website/`). It holds the
landing page, privacy policy, the `#goodbye` page, and the support form,
which posts via FormSubmit to a Trello board email. The site's "What's new"
section is a public copy of the release history — keep it in sync with
`CHANGELOG.md` and `extension/whats-new.json`.

## Firefox

The `firefox` branch is a snapshot sync of `main` with Firefox-only bits in
`manifest.json` (the `gecko` block, `background.scripts` instead of
`service_worker`). It is not a merge — after `main` moves, re-sync it the
same way and upload the new version to AMO by hand; the store listing does
not update itself.
