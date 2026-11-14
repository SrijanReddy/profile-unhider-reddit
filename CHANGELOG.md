# Changelog

The single release history. Keep it in sync with `extension/whats-new.json`
(what the popup shows) and the "What's new" section of the website
(`website/index.html`).

## Unreleased — code reorg (not a version bump)

- Split `extension/content.js` into `extension/content/`
  (config, utils, state, detection, api, renderers, panel, entry)
  and `extension/styles.css` into `content/panel.css`,
  `content/panel-views.css`, `content/panel-features.css`; shared
  helpers in `extension/shared/` (storage guard, popup `formatCount`)
- Stale-tab storage guard — content scripts in already-open tabs no
  longer crash when the extension reloads or updates
- `AGENTS.md` — instructions for AI agents working in this repo
- Fixed: the first reorg attempt listed a `content/panel.js` in the
  manifest that did not exist, and dropped the whole `buildPanel`
  function from the split. Both are fixed here.

## 4.0 — in `main`, not yet published to the stores

- Removed, deleted and NSFW tags — see which posts and comments were
  removed, deleted by the user or marked NSFW, and filter for them
  in Posts, Comments, and Insights

## 3.5.0 — in `main`

- Works on old Reddit too (old.reddit.com support)
- Activity heatmap — 26 weeks of activity at a glance in Insights
- More reliable loading — switches servers automatically if one is slow or down
- Fresh new popup — cleaner look, same buttons
- Panel stability fix for Reddit's SPA re-injection (one live panel copy,
  cached posts/comments, no refetch on re-inject)
- Popup overflow fix and stacked footer with the full site URL
- Compact stat counts (1k / 1.3k / 10k / 100k / 1M, full count on hover)

## 3.4.0

- Rating nudge — a gentle ask to leave a rating after your second reveal
- Support, built in — Support button in the popup
- Cleaner comments tab — removed the sort buttons that never worked;
  comments stay newest-first

## 3.3.2

- Faster loading — posts and comments appear instantly while the rest
  streams in behind them
- Smarter Insights — reuses already-loaded data, and the scan keeps running
  in the background while you browse other tabs

## 3.3.1

- Install welcome page now opens on the new website

## 3.3.0

- Insights — a breakdown of any profile's activity by subreddit
- Hover card badges — hidden/public status instantly on any username
- One-click unhide — click the badge to jump straight to unhiding that profile
- Deeper comment history — a profile's full comment history, not just what
  Reddit's own index happens to catch

## 3.2

- Hover card badges — see at a glance whether a profile is hidden or
  public when you click a username anywhere on Reddit
- Click the badge to open and unhide that profile

## 3.1

- Refresh button on the popup for slow polling

## 3.0

- Sort bar — sort posts and comments by New, Hot, Top, or Relevance
- Time filter — when sorting by Top, filter by Today, This week, This month,
  This year, or All time
- Popup revamp with a cleaner layout
- Reset stats from the popup
- Onboarding welcome page for new users
- Thumbnail fix for encoded image URLs
