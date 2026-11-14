/* detection.js — finding hidden profiles, plus the fallback banner.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── detection ── */
// Old Reddit never says "hidden" — a hidden profile just renders an empty overview
// ("there doesn't seem to be anything here") while the sidebar still shows karma.
// That same notice is legitimate on a /comments or /submitted tab of a public user
// who has only posts or only comments, so only trust it on the overview, and only
// when karma proves the account has activity (same heuristic as the hover badges).
function isOldRedditProfileHidden() {
  if (!/^\/(user|u)\/[^/]+\/?(overview\/?)?$/i.test(location.pathname)) return false;
  const text = (document.body.innerText || "").toLowerCase();
  if (!text.includes("there doesn't seem to be anything here") && !document.getElementById("noresults")) return false;
  const num = (sel) => {
    const el = document.querySelector(sel);
    return el ? parseInt(el.textContent.replace(/[^0-9]/g, ""), 10) || 0 : 0;
  };
  return num(".side .karma") + num(".side .comment-karma") > 0;
}

function isProfileHidden() {
  if (IS_OLD_REDDIT) return isOldRedditProfileHidden();
  const text = (document.body.innerText || "").toLowerCase();
  const phrases = [
    "likes to keep their posts hidden",
    "profile is hidden",
    "this user has set their profile to private",
    "user has set their profile to private",
    "hidden by the user",
  ];
  for (const p of phrases) { if (text.includes(p)) return true; }
  return false;
}

function findHiddenMessageEl() {
  if (IS_OLD_REDDIT) return findHiddenMessageElOld();
  const msgEl = Array.from(document.querySelectorAll("div")).find(
    (e) => e.childElementCount === 0 && e.textContent.includes("likes to keep their posts hidden")
  );
  if (msgEl) {
    let el = msgEl;
    for (let i = 0; i < 5; i++) {
      if (!el.parentElement) break;
      if (el.parentElement.tagName === "SHREDDIT-FEED") break;
      el = el.parentElement;
    }
    return el;
  }
  for (const sel of ['shreddit-profile-error', '[data-testid="profile-not-found"]']) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Old Reddit: the page is a plain server-rendered column (div.content > #siteTable).
// The "hidden" notice is an ordinary text element inside it, of unknown tag, so look
// for any leaf element carrying the phrase and climb to the child of the content
// column — never above it, or we'd hide the whole page.
function findHiddenMessageElOld() {
  const container = document.querySelector('div.content[role="main"]') || document.querySelector("div.content") || document.body;
  const phrases = ["there doesn't seem to be anything here", "likes to keep their posts hidden", "profile is hidden", "set their profile to private", "hidden by the user"];
  const msgEl = document.getElementById("noresults") || Array.from(container.querySelectorAll("div, p, span, h1, h2, h3, li")).find(
    (e) => e.childElementCount === 0 && phrases.some((p) => e.textContent.toLowerCase().includes(p))
  );
  if (msgEl) {
    let el = msgEl;
    while (el.parentElement && el.parentElement !== container && el.parentElement.id !== "siteTable" && el.parentElement !== document.body) {
      el = el.parentElement;
    }
    return el;
  }
  return document.getElementById("siteTable") || container.firstElementChild;
}

/* ── fallback banner ── */
const FALLBACK_MSGS = [
  "Extension didn't trigger on this page — refresh to retry",
  "Profile Unhider needs a refresh to work on this page",
  "Refresh to let Profile Unhider do its thing",
];

function injectFallbackBanner() {
  if (document.getElementById("rpu-fallback") || document.getElementById("rpu-trigger-wrap")) return;

  // Only show on user profile pages
  if (!getUsername()) return;
  // Old Reddit is server-rendered: nothing loads late, so "refresh to retry" would
  // only ever be noise on ordinary public profiles.
  if (IS_OLD_REDDIT) return;

  // Get cycling message index from storage
  storageGet(["fallbackMsgIndex"], (res) => {
    const idx = (res.fallbackMsgIndex || 0) % FALLBACK_MSGS.length;
    const msg = FALLBACK_MSGS[idx];
    storageSet({ fallbackMsgIndex: idx + 1 });

    // Find injection point — same as normal injection
    const anchor = findHiddenMessageEl();
    if (!anchor) return;

    const banner = document.createElement("div");
    banner.id = "rpu-fallback";
    banner.innerHTML = `
        <div class="rpu-trigger-inner rpu-fallback-inner">
          <div class="rpu-trigger-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Profile Unhider
          </div>
          <p class="rpu-fallback-msg">${esc(msg)}</p>
          <button id="rpu-refresh-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            Refresh page
          </button>
        </div>`;

    anchor.parentElement.insertBefore(banner, anchor);
    anchor.style.display = "none";

    document.getElementById("rpu-refresh-btn").addEventListener("click", () => {
      window.location.reload();
    });
  });
}
