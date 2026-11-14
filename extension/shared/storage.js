/* storage.js — stale-tab-safe storage helpers.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── Stale-tab guard ──
   Reloading or updating the extension leaves an already-injected content
   script running in open tabs, but its chrome.* APIs go away
   (chrome.storage becomes undefined, so reading .local throws
   "Cannot read properties of undefined"). Every storage call goes through
   these helpers and fails silent in that state instead of throwing. */
function storageAlive() {
  try {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  } catch (e) {
    return false;
  }
}
function storageGet(keys, cb) {
  if (!storageAlive()) return;
  try {
    chrome.storage.local.get(keys, (res) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      cb(res || {});
    });
  } catch (e) { /* stale context: ignore */ }
}
function storageSet(obj) {
  if (!storageAlive()) return;
  try {
    chrome.storage.local.set(obj);
  } catch (e) { /* stale context: ignore */ }
}
