# Profile Unhider

Chrome and Firefox extension that surfaces publicly indexed posts and
comments for Reddit users who have hidden their profiles. Data comes from
public archives — nothing private is ever accessed.

- [Add to Chrome](https://chromewebstore.google.com/detail/profile-unhider/kgfaggmcfklfakaaoijpeldikdokgfmp)
- [Add to Firefox](https://addons.mozilla.org/firefox/addon/profile-unhider/)
- [Website](https://profile-unhider.vercel.app/)

## What it does

Visit a hidden Reddit profile and the extension injects a panel with that
user's posts and comments, plus an Insights tab (activity by subreddit and
a 26-week heatmap). Hovering a username anywhere on Reddit shows a badge
with their hidden/public status. The toolbar popup shows reveal stats and
the extension's status on the current page.

## What's what

- `extension/` — the extension. `manifest.json` lives here. This is the
  folder you load unpacked and zip for the Web Store.
- `website/` — the landing page + privacy policy (static site).
- `docs/` — [architecture](docs/ARCHITECTURE.md) and
  [contributing](docs/CONTRIBUTING.md).
- `CHANGELOG.md` — release history.

## Extension

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
select `extension/`.

Ship to the Web Store — zip ONLY the extension folder:

    cd extension && zip -r ../profile-unhider.zip . -x '*.DS_Store'

(or `npm run zip`). See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for the
full release checklist.

## Website

Static site. Deploy from the `website/` directory — set your
Vercel/Netlify project root to `website/`.

When cutting a release, update the version history in `CHANGELOG.md`,
`extension/whats-new.json`, and the site's What's new section.
