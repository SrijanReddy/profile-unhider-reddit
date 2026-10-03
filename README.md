# Profile Unhider

Chrome extension that surfaces publicly indexed posts and comments
for Reddit users who have hidden their profiles.

## What's what

- `extension/` — the Chrome extension. `manifest.json` lives here.
  This is the folder you load unpacked and zip for the Web Store.
- `website/` — the landing page + privacy policy (static site).

## Extension

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.

Ship to the Web Store — zip ONLY the extension folder:

    cd extension && zip -r ../profile-unhider.zip . -x '*.DS_Store'

## Website

Static site. Deploy from the `website/` directory — set your
Vercel/Netlify project root to `website/`.

When cutting a release, update the version history in both
`extension/whats-new.json` and the site's What's new section.
