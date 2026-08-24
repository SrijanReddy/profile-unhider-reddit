(function () {
  "use strict";

  /* ── flag ── */
  window.__rpuInjected = false;

  /* ── session tracking (in-memory, resets on tab close/reload) ── */
  const _sessionRevealed = new Set();

  /* ── helpers ── */
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeAgo(utc) {
    const s = Math.floor(Date.now() / 1000) - utc;
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

  /* ── detection ── */
  function isProfileHidden() {
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

    // Get cycling message index from storage
    chrome.storage.local.get(["fallbackMsgIndex"], (res) => {
      const idx = (res.fallbackMsgIndex || 0) % FALLBACK_MSGS.length;
      const msg = FALLBACK_MSGS[idx];
      chrome.storage.local.set({ fallbackMsgIndex: idx + 1 });

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

  /* ── stats tracking ── */
  function trackProfile(username) {
    // Per-session dedup — don't count same profile twice in same session
    if (_sessionRevealed.has(username)) return;
    _sessionRevealed.add(username);
    chrome.storage.local.get(["profilesRevealed"], (res) => {
      chrome.storage.local.set({ profilesRevealed: (res.profilesRevealed || 0) + 1 });
    });
  }

  function trackPosts(count) {
    chrome.storage.local.get(["postsSurfaced"], (res) => {
      chrome.storage.local.set({ postsSurfaced: (res.postsSurfaced || 0) + count });
    });
  }

  /* ── API: fetch posts ── */
  async function fetchPosts(username, after, sort, time) {
    sort = sort || "new";
    let url = `https://www.reddit.com/search.json?q=author%3A${encodeURIComponent(username)}&type=link&limit=25&sort=${sort}`;
    if (sort === "top" && time) url += `&t=${time}`;
    if (after) url += `&after=${encodeURIComponent(after)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    return {
      items: json.data.children.map((c) => c.data),
      after: json.data.after || null,
    };
  }

  /* ── comments ── */
  function findCommentByAuthor(children, author) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.kind === "t1" && c.data && c.data.author === author && c.data.body) return c.data;
      if (c.data && c.data.replies && c.data.replies.data && c.data.replies.data.children) {
        var found = findCommentByAuthor(c.data.replies.data.children, author);
        if (found) return found;
      }
    }
    return null;
  }

  async function hydrateStub(stub, username) {
    try {
      var parts = (stub.permalink || "").split("/").filter(function(p) { return p.length > 0; });
      var postId = parts[3];
      var sub = stub.subreddit;
      if (!postId) return null;
      var url = "https://www.reddit.com/r/" + sub + "/comments/" + postId + ".json?limit=500&raw_json=1";
      var r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      var data = await r.json();
      var threadChildren = (data[1] && data[1].data && data[1].data.children) || [];
      var comment = findCommentByAuthor(threadChildren, username);
      if (!comment) return null;
      return Object.assign({}, stub, {
        body: comment.body,
        permalink: comment.permalink || stub.permalink,
        link_title: comment.link_title || stub.link_title || stub.title || "",
      });
    } catch(e) { return null; }
  }

  async function fetchComments(username, after, sort, time) {
    sort = sort || "new";
    const q = encodeURIComponent('Author:"' + username + '"');
    let url = "https://www.reddit.com/search.json?q=" + q + "&type=comment&limit=25&sort=" + sort + "&raw_json=1";
    if (sort === "top" && time) url += "&t=" + time;
    if (after) url += "&after=" + encodeURIComponent(after);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    const stubs = json.data.children.map(function(c) { return c.data; });
    const cursor = json.data.after || null;
    const results = await Promise.all(stubs.map(function(s) { return hydrateStub(s, username); }));
    return { items: results.filter(function(c) { return c !== null; }), after: cursor };
  }

  /* ── insights: subreddit activity scan ── */
  async function fetchSubredditPage(kind, username, after) {
    let url;
    if (kind === "comment") {
      const q = encodeURIComponent('Author:"' + username + '"');
      url = "https://www.reddit.com/search.json?q=" + q + "&type=comment&limit=100&sort=new&raw_json=1";
    } else {
      url = `https://www.reddit.com/search.json?q=author%3A${encodeURIComponent(username)}&type=link&limit=100&sort=new`;
    }
    if (after) url += "&after=" + encodeURIComponent(after);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429) { const e = new Error("Rate limited by Reddit — showing partial results"); e.rateLimited = true; throw e; }
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    return { items: json.data.children.map((c) => c.data), after: json.data.after || null };
  }

  // Walks every page of a user's posts or comments, tallying per-subreddit counts into `subs`.
  // Only reads the lightweight subreddit field off each stub — comments are NOT hydrated here,
  // since that would cost one extra thread fetch per comment just to learn a subreddit we already know.
  async function scanSubredditActivity(kind, username, subs, onPage, shouldCancel) {
    let after = null, pages = 0, count = 0;
    const MAX_PAGES = 40; // Reddit's search index caps out around this many pages anyway
    do {
      if (shouldCancel()) return { count, cancelled: true };
      let page;
      try {
        page = await fetchSubredditPage(kind, username, after);
      } catch (e) {
        if (e.rateLimited) return { count, cancelled: true };
        throw e;
      }
      for (const item of page.items) {
        const key = item.subreddit || "unknown";
        const entry = subs.get(key) || { posts: 0, comments: 0 };
        if (kind === "comment") entry.comments++; else entry.posts++;
        subs.set(key, entry);
      }
      count += page.items.length;
      pages++;
      after = page.after;
      onPage(pages, count);
    } while (after && pages < MAX_PAGES);
    return { count, cancelled: false };
  }

  async function scanInsights(username, onProgress, shouldCancel) {
    const subs = new Map();
    const postsResult = await scanSubredditActivity("link", username, subs, (page, count) => {
      onProgress({ phase: "posts", page, totalPosts: count, totalComments: 0 });
    }, shouldCancel);
    const totalPosts = postsResult.count;
    if (postsResult.cancelled) return { subs, totalPosts, totalComments: 0, cancelled: true };

    const commentsResult = await scanSubredditActivity("comment", username, subs, (page, count) => {
      onProgress({ phase: "comments", page, totalPosts, totalComments: count });
    }, shouldCancel);
    return { subs, totalPosts, totalComments: commentsResult.count, cancelled: commentsResult.cancelled };
  }

  /* ── renderers ── */
  function upArrow() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff4500" stroke-width="2.5" style="display:block"><polyline points="18 15 12 9 6 15"/></svg>`;
  }

  function commentIcon(w) {
    return `<svg width="${w||11}" height="${w||11}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  }

  function renderPost(p) {
    let thumbHtml;
    const hasThumb = p.thumbnail && !["self","default","nsfw","image","spoiler",""].includes(p.thumbnail) && p.thumbnail.startsWith("http");
    // Decode HTML entities in URLs before use
    function decodeUrl(url) { return (url || "").replace(/&amp;/g, "&"); }

    if (hasThumb) {
      thumbHtml = `<img src="${decodeUrl(p.thumbnail)}" alt="" loading="lazy" />`;
    } else {
      const preview = p.preview && p.preview.images && p.preview.images[0];
      const res = preview && preview.resolutions;
      const previewUrl = res && res.length > 0 ? decodeUrl(res[Math.min(1, res.length - 1)].url) : null;
      thumbHtml = previewUrl
        ? `<img src="${previewUrl}" alt="" loading="lazy" />`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
    }
    return `
      <div class="rpu-card">
        <div class="rpu-vote">${upArrow()}<span class="rpu-score">${fmtScore(p.score || 0)}</span></div>
        <div class="rpu-thumb">${thumbHtml}</div>
        <div class="rpu-card-body">
          <div class="rpu-card-meta">
            <a class="rpu-subreddit" href="https://www.reddit.com/r/${esc(p.subreddit)}/" target="_blank" rel="noopener">${esc(p.subreddit_name_prefixed || "r/" + p.subreddit)}</a>
            <span class="rpu-dot">·</span>
            <span>${timeAgo(p.created_utc)}</span>
            ${p.over_18 ? '<span class="rpu-nsfw-tag">NSFW</span>' : ""}
          </div>
          <a class="rpu-card-title" href="https://www.reddit.com${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.title)}</a>
          <div class="rpu-card-footer">
            <span class="rpu-comments-count">${commentIcon(11)} ${p.num_comments || 0} comments</span>
          </div>
        </div>
      </div>`;
  }

  function renderComment(c) {
    const rawBody = c.body || "";
    const body = esc(rawBody.slice(0, 300)) + (rawBody.length > 300 ? "…" : "");
    const hasBody = rawBody.trim().length > 0;
    const match = (c.permalink || "").match(/\/comments\/([a-z0-9]+)\/[^/]*\/([a-z0-9]+)/i);
    const commentUrl = match
      ? `https://www.reddit.com/r/${esc(c.subreddit)}/comments/${match[1]}/_/${match[2]}/?context=3`
      : `https://www.reddit.com${esc(c.permalink)}?context=3`;
    return `
      <div class="rpu-card rpu-comment-card">
        <div class="rpu-vote">${upArrow()}<span class="rpu-score">${fmtScore(c.score || 0)}</span></div>
        <div class="rpu-card-body">
          <div class="rpu-card-meta">
            <a class="rpu-subreddit" href="https://www.reddit.com/r/${esc(c.subreddit)}/" target="_blank" rel="noopener">${esc(c.subreddit_name_prefixed || "r/" + c.subreddit)}</a>
            <span class="rpu-dot">·</span>
            <span>${timeAgo(c.created_utc)}</span>
          </div>
          <a class="rpu-comment-thread" href="${commentUrl}" target="_blank" rel="noopener">
            ${commentIcon(11)} ${esc(c.link_title || "View thread")}
          </a>
          ${hasBody ? `<p class="rpu-comment-body">${body}</p>` : `<p class="rpu-comment-body rpu-comment-body--empty">Loading comment…</p>`}
          <a class="rpu-view-link" href="${commentUrl}" target="_blank" rel="noopener">View in thread →</a>
        </div>
      </div>`;
  }

  function renderInsights(data) {
    const entries = Array.from(data.subs.entries())
      .map(([sub, c]) => ({ sub, posts: c.posts, comments: c.comments, total: c.posts + c.comments }))
      .sort((a, b) => b.total - a.total);
    const maxTotal = entries.length ? entries[0].total : 1;

    const rows = entries.map((e) => `
      <div class="rpu-insight-row">
        <a class="rpu-insight-sub" href="https://www.reddit.com/r/${esc(e.sub)}/" target="_blank" rel="noopener">r/${esc(e.sub)}</a>
        <div class="rpu-insight-bar-track">
          <div class="rpu-insight-bar-fill" style="width:${Math.max(4, Math.round((e.total / maxTotal) * 100))}%"></div>
        </div>
        <span class="rpu-insight-count">${e.total}${e.posts && e.comments ? ` <span class="rpu-insight-split">(${e.posts}p·${e.comments}c)</span>` : ""}</span>
      </div>`).join("");

    return `
      <div class="rpu-insight-summary">
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${entries.length}</span><span class="rpu-insight-stat-label">subreddits</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalPosts}</span><span class="rpu-insight-stat-label">posts</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalComments}</span><span class="rpu-insight-stat-label">comments</span></div>
      </div>
      ${data.cancelled ? `<p class="rpu-insight-note">Scan stopped early (rate limited) — showing partial results.</p>` : ""}
      <div class="rpu-insight-list">${rows || '<p class="rpu-empty-sub">No activity found.</p>'}</div>`;
  }

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
            <p class="rpu-sub-label">Profile hidden <span class="rpu-index-badge">via search index</span></p>
          </div>
        </div>
        <button class="rpu-close-btn" id="rpu-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="rpu-tabs">
        <button class="rpu-tab rpu-tab-active" data-tab="posts">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          Posts
        </button>
        <button class="rpu-tab" data-tab="comments">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Comments
        </button>
        <button class="rpu-tab" data-tab="insights">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
          Insights
        </button>
      </div>
      <div class="rpu-sort-bar" id="rpu-sort-bar">
        <div class="rpu-sort-options">
          <button class="rpu-sort-btn rpu-sort-active" data-sort="new">New</button>
          <button class="rpu-sort-btn" data-sort="hot">Hot</button>
          <button class="rpu-sort-btn" data-sort="top">Top</button>
          <button class="rpu-sort-btn" data-sort="relevance">Relevance</button>
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
      <div class="rpu-content" id="rpu-content">
        <div class="rpu-loading" id="rpu-loading">
          <div class="rpu-spinner"></div><span>Fetching posts…</span>
        </div>
      </div>
      <div class="rpu-load-more-wrap" id="rpu-load-more-wrap" style="display:none;">
        <button class="rpu-load-more-btn" id="rpu-load-more">Load more</button>
      </div>`;
    return panel;
  }

  /* ── inject ── */
  function inject(username) {
    if (document.getElementById("rpu-trigger-wrap")) return;

    window.__rpuInjected = true;
    trackProfile(username);

    // Disclaimer in profile header
    const profileMain = document.querySelector('[data-testid="profile-main"], div.px-md.relative.pt-md');
    if (profileMain && !document.getElementById("rpu-disclaimer")) {
      const disclaimer = document.createElement("div");
      disclaimer.id = "rpu-disclaimer";
      disclaimer.innerHTML = `
        <div class="rpu-disclaimer-inner">
          <div class="rpu-disclaimer-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff4500" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div class="rpu-disclaimer-text">
            <span class="rpu-disclaimer-title">Profile Unhider</span>
            <span class="rpu-disclaimer-body">Posts &amp; comments are sourced from Reddit's public search index. Only publicly visible content is shown. <a class="rpu-disclaimer-link" href="https://profile-unhider.netlify.app/privacy" target="_blank" rel="noopener">Privacy policy</a></span>
          </div>
        </div>`;
      profileMain.appendChild(disclaimer);
    }

    const anchor = findHiddenMessageEl();
    if (!anchor) return;

    const triggerWrap = document.createElement("div");
    triggerWrap.id = "rpu-trigger-wrap";
    triggerWrap.innerHTML = `
      <div class="rpu-trigger-inner">
        <div class="rpu-trigger-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Reddit Profile Unhider
        </div>
        <button id="rpu-reveal-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Reveal activity
        </button>
        <div class="rpu-trigger-sub">Shows posts &amp; comments from Reddit's search index</div>
      </div>`;

    anchor.parentElement.insertBefore(triggerWrap, anchor);
    anchor.style.display = "none";

    let panelEl = null;
    let panelOpen = false;
    const state = {
      activeTab: "posts",
      sort: "new",
      time: "all",
      posts: { items: [], after: null, loaded: false },
      comments: { items: [], after: null, loaded: false },
      insights: { loaded: false, data: null },
    };

    const getEl = (id) => document.getElementById(id);

    function showLoading(msg) {
      const el = getEl("rpu-loading");
      if (el) { el.style.display = "flex"; el.innerHTML = `<div class="rpu-spinner"></div><span>${esc(msg)}</span>`; }
    }
    function hideLoading() {
      const el = getEl("rpu-loading");
      if (el) el.style.display = "none";
    }

    function clearContent() {
      const content = getEl("rpu-content");
      if (content) content.querySelectorAll(".rpu-card, .rpu-empty, .rpu-error, .rpu-insight-summary, .rpu-insight-list, .rpu-insight-note").forEach((el) => el.remove());
    }

    function renderItems() {
      const tab = state.activeTab;
      const { items, after } = state[tab];
      const content = getEl("rpu-content");
      if (!content) return;
      clearContent();
      hideLoading();

      if (items.length === 0) {
        content.insertAdjacentHTML("beforeend", `
          <div class="rpu-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>No ${tab} found for u/${esc(username)}</span>
            <p class="rpu-empty-sub">They may have no public ${tab}, or Reddit's index hasn't captured them.</p>
          </div>`);
        getEl("rpu-load-more-wrap").style.display = "none";
        return;
      }

      const html = items.map((item) => tab === "posts" ? renderPost(item) : renderComment(item)).join("");
      content.insertAdjacentHTML("beforeend", html);
      getEl("rpu-load-more-wrap").style.display = after ? "flex" : "none";

      // Track posts surfaced
      if (tab === "posts") trackPosts(items.length);
    }

    async function loadTab(tab) {
      state.activeTab = tab;
      panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
        btn.classList.toggle("rpu-tab-active", btn.dataset.tab === tab);
      });
      getEl("rpu-load-more-wrap").style.display = "none";
      if (tab === "insights") { await loadInsights(); return; }
      if (state[tab].loaded) { renderItems(); return; }
      clearContent();
      showLoading(tab === "comments" ? "Fetching comments… (scanning threads)" : "Fetching posts…");
      try {
        const result = tab === "posts"
          ? await fetchPosts(username, null, state.sort, state.time)
          : await fetchComments(username, null, state.sort, state.time);
        state[tab].items = result.items;
        state[tab].after = result.after;
        state[tab].loaded = true;
        renderItems();
      } catch (err) {
        hideLoading();
        getEl("rpu-content").insertAdjacentHTML("beforeend", `
          <div class="rpu-error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Failed to fetch ${tab}: ${esc(err.message)}</span>
          </div>`);
      }
    }

    async function loadInsights() {
      if (state.insights.loaded) { renderInsightsView(); return; }
      clearContent();
      showLoading("Scanning subreddits… (page 1)");
      try {
        const data = await scanInsights(
          username,
          (progress) => {
            if (state.activeTab !== "insights") return;
            const found = progress.totalPosts + progress.totalComments;
            showLoading(`Scanning subreddits… (${progress.phase}, page ${progress.page}, ${found} found)`);
          },
          () => state.activeTab !== "insights"
        );
        if (data.cancelled) return; // user navigated away mid-scan — don't cache partial data, re-scan next visit
        state.insights.data = data;
        state.insights.loaded = true;
        if (state.activeTab === "insights") renderInsightsView();
      } catch (err) {
        if (state.activeTab !== "insights") return;
        hideLoading();
        getEl("rpu-content").insertAdjacentHTML("beforeend", `
          <div class="rpu-error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Failed to scan subreddits: ${esc(err.message)}</span>
          </div>`);
      }
    }

    function renderInsightsView() {
      clearContent();
      hideLoading();
      getEl("rpu-content").insertAdjacentHTML("beforeend", renderInsights(state.insights.data));
    }

    async function loadMore() {
      const tab = state.activeTab;
      if (!state[tab].after) return;
      const btn = getEl("rpu-load-more");
      btn.disabled = true;
      btn.textContent = "Loading…";
      try {
        const result = tab === "posts"
          ? await fetchPosts(username, state[tab].after, state.sort, state.time)
          : await fetchComments(username, state[tab].after, state.sort, state.time);
        state[tab].items = [...state[tab].items, ...result.items];
        state[tab].after = result.after;
        const newHtml = result.items.map((item) => tab === "posts" ? renderPost(item) : renderComment(item)).join("");
        getEl("rpu-content").insertAdjacentHTML("beforeend", newHtml);
        getEl("rpu-load-more-wrap").style.display = result.after ? "flex" : "none";
        if (tab === "posts") trackPosts(result.items.length);
      } catch (err) { console.error("[RPU]", err); }
      btn.disabled = false;
      btn.textContent = "Load more";
    }

    function resetTabState(tab) {
      state[tab].items = [];
      state[tab].after = null;
      state[tab].loaded = false;
    }

    function openPanel() {
      if (panelEl) return;
      panelEl = buildPanel(username);
      triggerWrap.after(panelEl);

      // Tab clicks
      panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          getEl("rpu-sort-bar").style.display = tab === "insights" ? "none" : "flex";
          if (tab !== "insights") {
            // Reset sort to new when switching tabs
            state.sort = "new";
            state.time = "all";
            panelEl.querySelectorAll(".rpu-sort-btn").forEach(b => b.classList.remove("rpu-sort-active"));
            panelEl.querySelector('[data-sort="new"]').classList.add("rpu-sort-active");
            getEl("rpu-time-filter").style.display = "none";
          }
          loadTab(tab);
        });
      });

      // Sort button clicks
      panelEl.querySelectorAll(".rpu-sort-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const newSort = btn.dataset.sort;
          if (newSort === state.sort) return;
          state.sort = newSort;
          state.time = "all";
          panelEl.querySelectorAll(".rpu-sort-btn").forEach(b => b.classList.remove("rpu-sort-active"));
          btn.classList.add("rpu-sort-active");
          // Show/hide time filter
          getEl("rpu-time-filter").style.display = newSort === "top" ? "block" : "none";
          // Reset and re-fetch
          resetTabState(state.activeTab);
          loadTab(state.activeTab);
        });
      });

      // Time filter change
      getEl("rpu-time-select").addEventListener("change", (e) => {
        state.time = e.target.value;
        resetTabState(state.activeTab);
        loadTab(state.activeTab);
      });

      panelEl.addEventListener("click", (e) => { if (e.target.id === "rpu-load-more") loadMore(); });
      getEl("rpu-close").addEventListener("click", closePanel);
      loadTab("posts");
    }

    function closePanel() {
      if (panelEl) { panelEl.remove(); panelEl = null; }
      panelOpen = false;
      const btn = getEl("rpu-reveal-btn");
      if (btn) {
        btn.classList.remove("rpu-active");
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Reveal activity`;
      }
    }

    getEl("rpu-reveal-btn").addEventListener("click", () => {
      panelOpen = !panelOpen;
      const btn = getEl("rpu-reveal-btn");
      if (panelOpen) {
        btn.classList.add("rpu-active");
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Hide activity`;
        openPanel();
      } else {
        closePanel();
      }
    });
  }

  /* ── polling + SPA ── */
  let injected = false, checks = 0;

  function tryInject() {
    if (injected) return;
    const username = getUsername();
    if (!username) return;
    if (isProfileHidden()) { injected = true; inject(username); }
  }

  const timer = setInterval(() => {
    checks++;
    tryInject();
    if (checks >= 30) {
      clearInterval(timer);
      // Show fallback banner if extension never triggered
      if (!window.__rpuInjected && getUsername()) {
        injectFallbackBanner();
      }
    }
    if (injected) clearInterval(timer);
  }, 800);

  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      injected = false;
      checks = 0;
      window.__rpuInjected = false;
      setTimeout(tryInject, 1200);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ── Message listener for popup status queries ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getStatus") {
    sendResponse({ injected: window.__rpuInjected === true });
  }
  return true;
});
