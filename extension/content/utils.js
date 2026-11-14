/* utils.js — small shared helpers (escaping, time, scores, username).
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── helpers ── */
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function timeAgo(utc) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - utc));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 2592000) return Math.floor(s / 86400) + "d ago";
  if (s < 31536000) return Math.floor(s / 2592000) + "mo ago";
  return Math.floor(s / 31536000) + "y ago";
}

function fmtScore(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function getUsername() {
  const m = window.location.pathname.match(/^\/user\/([^/]+)/i);
  return m ? m[1] : null;
}
