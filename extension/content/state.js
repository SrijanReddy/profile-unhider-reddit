/* state.js — session state, theme, stats tracking, rating nudge.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── session tracking (in-memory, resets on tab close/reload) ── */
const _sessionRevealed = new Set();
let _rateNudgeShown = false;

/* ── theme ──
   Default follows the OS (prefers-color-scheme). The popup's and the panel's
   sun/moon buttons store an explicit "light"/"dark" in chrome.storage, which sets
   data-rpu-theme on <html>; the panel stylesheets key off that attribute. */
function effectiveTheme() {
  const t = document.documentElement.getAttribute("data-rpu-theme");
  if (t) return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function themeIcon() {
  // Show where a click takes you: a sun while dark, a moon while light.
  return effectiveTheme() === "dark"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
}
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-rpu-theme", t);
  else document.documentElement.removeAttribute("data-rpu-theme");
  const btn = document.getElementById("rpu-theme");
  if (btn) btn.innerHTML = themeIcon();
}
storageGet(["theme"], (res) => applyTheme(res.theme));
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.theme) applyTheme(changes.theme.newValue);
  });
}

/* ── stats tracking ── */
function trackProfile(username) {
  // Per-session dedup — don't count same profile twice in same session
  if (_sessionRevealed.has(username)) return;
  _sessionRevealed.add(username);
  storageGet(["profilesRevealed"], (res) => {
    storageSet({ profilesRevealed: (res.profilesRevealed || 0) + 1 });
  });
}

function trackPosts(count) {
  storageGet(["postsSurfaced"], (res) => {
    storageSet({ postsSurfaced: (res.postsSurfaced || 0) + count });
  });
}

/* ── rating nudge: ask once the user has had a few successful reveals ── */
const RATE_NUDGE_MIN_REVEALS = 2;
const RATE_NUDGE_SNOOZE_MS = 7 * 24 * 3600 * 1000;

function maybeShowRatingNudge() {
  if (_rateNudgeShown) return;
  storageGet(
    ["profilesRevealed", "ratingNudgeDismissed", "ratingNudgeSnoozedUntil"],
    (res) => {
      if ((res.profilesRevealed || 0) < RATE_NUDGE_MIN_REVEALS) return;
      if (res.ratingNudgeDismissed) return;
      if (res.ratingNudgeSnoozedUntil && Date.now() < res.ratingNudgeSnoozedUntil) return;
      _rateNudgeShown = true;
      showRatingNudge();
    }
  );
}

function showRatingNudge() {
  const panel = document.getElementById("rpu-panel");
  if (!panel || document.getElementById("rpu-rate-nudge")) return;
  const isFirefox = navigator.userAgent.indexOf("Firefox") !== -1;
  const reviewUrl = isFirefox
    ? "https://addons.mozilla.org/firefox/addon/profile-unhider/reviews/"
    : "https://chromewebstore.google.com/detail/profile-unhider/kgfaggmcfklfakaaoijpeldikdokgfmp/reviews";
  const nudge = document.createElement("div");
  nudge.id = "rpu-rate-nudge";
  nudge.innerHTML =
    '<div class="rpu-rate-nudge-inner">' +
    '<span class="rpu-rate-nudge-text">Enjoying Profile Unhider?</span>' +
    '<div class="rpu-rate-nudge-btns">' +
    '<button class="rpu-rate-nudge-rate" id="rpu-rate-yes">Leave a rating</button>' +
    '<button class="rpu-rate-nudge-snooze" id="rpu-rate-later">Not now</button>' +
    '<button class="rpu-rate-nudge-dismiss" id="rpu-rate-never" title="Don\'t ask again">✕</button>' +
    "</div></div>";
  const head = panel.querySelector(".rpu-head");
  if (head) head.after(nudge);
  else panel.prepend(nudge);
  document.getElementById("rpu-rate-yes").addEventListener("click", () => {
    storageSet({ ratingNudgeDismissed: true });
    window.open(reviewUrl, "_blank", "noopener");
    nudge.remove();
  });
  document.getElementById("rpu-rate-later").addEventListener("click", () => {
    storageSet({ ratingNudgeSnoozedUntil: Date.now() + RATE_NUDGE_SNOOZE_MS });
    nudge.remove();
  });
  document.getElementById("rpu-rate-never").addEventListener("click", () => {
    storageSet({ ratingNudgeDismissed: true });
    nudge.remove();
  });
}
