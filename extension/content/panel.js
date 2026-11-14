/* panel.js — the on-page panel (buildPanel).
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── panel ── */
function buildPanel(username) {
  const panel = document.createElement("div");
  panel.id = "rpu-panel";
  panel.innerHTML = `
      <div class="rpu-head">
        <div class="rpu-head-left">
          <div class="rpu-avatar">${esc(String(username[0]).toUpperCase())}</div>
          <div>
            <p class="rpu-username">u/${esc(username)}</p>
            <p class="rpu-sub-label">Profile hidden</p>
          </div>
        </div>
        <div class="rpu-head-actions">
          <button class="rpu-close-btn" id="rpu-theme" title="Switch light / dark mode">${themeIcon()}</button>
          <button class="rpu-close-btn" id="rpu-close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="rpu-servers" id="rpu-servers"></div>
      <div class="rpu-tabs">
        <button class="rpu-tab rpu-tab-active" data-tab="posts">
          <span class="rpu-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></span><svg class="rpu-tab-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          Posts<span class="rpu-tab-tag" id="rpu-tag-posts"></span>
        </button>
        <button class="rpu-tab" data-tab="comments">
          <span class="rpu-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><svg class="rpu-tab-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          Comments<span class="rpu-tab-tag" id="rpu-tag-comments"></span>
        </button>
        <button class="rpu-tab" data-tab="insights">
          <span class="rpu-tab-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></span><svg class="rpu-tab-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          Insights<span class="rpu-tab-tag" id="rpu-tag-insights"></span>
        </button>
      </div>
      <div class="rpu-sort-bar" id="rpu-sort-bar">
        <div class="rpu-sort-options">
          <button class="rpu-sort-btn rpu-sort-active" data-sort="new">New</button>
          <button class="rpu-sort-btn" data-sort="hot">Hot</button>
          <button class="rpu-sort-btn" data-sort="top">Top</button>
          <button class="rpu-sort-btn" data-sort="relevance">Relevance</button>
        </div>
        <button class="rpu-flag-filter" id="rpu-flag-filter" hidden>Removed or deleted <b id="rpu-flag-count">0</b></button>
        <button class="rpu-flag-filter" id="rpu-nsfw-filter" hidden>NSFW <b id="rpu-nsfw-count">0</b></button>
        <div class="rpu-item-search-wrap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="rpu-item-search" id="rpu-item-search" placeholder="Search…" autocomplete="off" />
        </div>
        <div class="rpu-time-filter" id="rpu-time-filter" style="display:none;">
          <select class="rpu-time-select" id="rpu-time-select">
            <option value="day">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>
      <div class="rpu-notice" id="rpu-notice" hidden></div>
      <div class="rpu-content" id="rpu-content">
        <div class="rpu-loading" id="rpu-loading">
          <div class="rpu-spinner"></div><span>Fetching posts…</span>
        </div>
      </div>
      <div class="rpu-pagination" id="rpu-pagination" style="display:none;">
        <button class="rpu-page-btn" id="rpu-prev-page" title="Previous page">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="rpu-page-info" id="rpu-page-info">Page 1 of 1</span>
        <button class="rpu-page-btn" id="rpu-next-page" title="Next page">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="rpu-footer" id="rpu-footer"></div>`;
  return panel;
}
