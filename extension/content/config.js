/* config.js — which Reddit this is, plus the injected flag.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── flag ── */
window.__rpuInjected = false;

/* ── which Reddit are we on? ──
   old.reddit.com is a completely different (server-rendered) site from the
   redesign: different DOM, no shreddit web components, and API calls must be
   same-origin. ORIGIN keeps both the fetches and the links we render on
   whichever Reddit the user is actually browsing. */
const IS_OLD_REDDIT = location.hostname === "old.reddit.com";
const ORIGIN = location.origin;
if (IS_OLD_REDDIT) document.documentElement.classList.add("rpu-old");
