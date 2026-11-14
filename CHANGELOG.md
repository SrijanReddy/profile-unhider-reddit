# Changelog

The single release history. Keep it in sync with `extension/whats-new.json`
(what the popup shows) and the "What's new" section of the website
(`website/index.html`).

## 3.5.0 — in `main`, not yet published to the stores

- Works on old Reddit too (old.reddit.com support)
- Activity heatmap — 26 weeks of activity at a glance in Insights
- More reliable loading — switches servers automatically if one is slow or down
- Fresh new popup — cleaner look, same buttons
- Panel stability fix for Reddit's SPA re-injection (one live panel copy,
  cached posts/comments, no refetch on re-inject)
- Stale-tab storage guard — content scripts in already-open tabs no longer
  crash when the extension reloads or updates
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
