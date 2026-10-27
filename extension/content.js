(function () {
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

  /* ── session tracking (in-memory, resets on tab close/reload) ── */
  const _sessionRevealed = new Set();
  let _rateNudgeShown = false;

  /* ── theme ──
     Default follows the OS (prefers-color-scheme). The popup's and the panel's
     sun/moon buttons store an explicit "light"/"dark" in chrome.storage, which sets
     data-rpu-theme on <html>; styles.css keys off that attribute. */
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
  chrome.storage.local.get(["theme"], (res) => applyTheme(res.theme));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.theme) applyTheme(changes.theme.newValue);
  });

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

  /* ── rating nudge: ask once the user has had a few successful reveals ── */
  const RATE_NUDGE_MIN_REVEALS = 2;
  const RATE_NUDGE_SNOOZE_MS = 7 * 24 * 3600 * 1000;

  function maybeShowRatingNudge() {
    if (_rateNudgeShown) return;
    chrome.storage.local.get(
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
      chrome.storage.local.set({ ratingNudgeDismissed: true });
      window.open(reviewUrl, "_blank", "noopener");
      nudge.remove();
    });
    document.getElementById("rpu-rate-later").addEventListener("click", () => {
      chrome.storage.local.set({ ratingNudgeSnoozedUntil: Date.now() + RATE_NUDGE_SNOOZE_MS });
      nudge.remove();
    });
    document.getElementById("rpu-rate-never").addEventListener("click", () => {
      chrome.storage.local.set({ ratingNudgeDismissed: true });
      nudge.remove();
    });
  }

  /* ── API: fetch posts ── */
  // Posts use the same archive mechanism as comments (see fetchArchive). The archives
  // only order by time, so `sort`/`time` are applied client-side — see sortedItems().
  async function fetchPosts(username, after, sort, time, limit) {
    return fetchArchive("submission", username, after, limit);

    /* ── fallback (pre-2026-10-25): Reddit's own search.json ──
       Used before posts moved to the archives above. Swap to revert.
    sort = sort || "new";
    limit = limit || 25;
    let url = `${ORIGIN}/search.json?q=author%3A${encodeURIComponent(username)}&type=link&limit=${limit}&sort=${sort}`;
    if (sort === "top" && time) url += `&t=${time}`;
    if (after) url += `&after=${encodeURIComponent(after)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    return { items: json.data.children.map((c) => c.data), after: json.data.after || null };
    */
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
      var url = ORIGIN + "/r/" + sub + "/comments/" + postId + ".json?limit=500&raw_json=1";
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

  // PullPush being slow/overloaded/down all look the same to the user — show one
  // friendly message instead of a raw status code.
  function busyError() {
    const e = new Error("A lot of traffic right now, please try again in a bit.");
    e.friendly = true;
    return e;
  }
  // Shared by posts and comments. Third-party archival indexes (not live Reddit
  // endpoints), so they aren't subject to a hidden profile's own listing restriction.
  // Comments try PullPush first, posts try Arctic Shift first; on an error, rate limit (429)
  // or an empty first page (coverage has gaps) the other one is tried before giving up.
  async function fetchArchive(kind, username, after, limit) {
    limit = Math.min(limit || 25, 100); // both archives cap page size at 100
    // Third-party archival indexes (not live Reddit endpoints), so they aren't subject
    // to the account's own "hide profile" listing restriction. PullPush is tried first;
    // if it errors or rate-limits (HTTP 429), Arctic Shift is tried before giving up.
    // Pagination is time-cursor based: `after` holds the created_utc (unix seconds)
    // of the last item from the previous page, passed back as `before` since we always
    // walk newest -> oldest. No `sort`/`time` mapping — both only order by time.
    const before = after ? encodeURIComponent(Math.floor(after)) : null;
    const u = encodeURIComponent(username);
    const sources = [
      "https://api.pullpush.io/reddit/search/" + (kind === "comment" ? "comment" : "submission") + "/?author=" + u + "&size=" + limit + "&sort=desc&sort_type=created_utc" + (before ? "&before=" + before : ""),
      "https://arctic-shift.photon-reddit.com/api/" + (kind === "comment" ? "comments" : "posts") + "/search?author=" + u + "&limit=" + limit + "&sort=desc&meta-app=profile-unhider" + (before ? "&before=" + before : ""),
    ];
    // Posts try Arctic Shift first, comments try PullPush first.
    if (kind !== "comment") sources.reverse();
    // Remember responses for a few minutes so reloading the profile or reopening the
    // panel doesn't re-hit the APIs (PullPush in particular rate-limits aggressively).
    const cacheKey = "rpu-" + kind + ":" + u + ":" + limit + ":" + (before || "");
    let items = null;
    try {
      const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (hit && hit.items.length && Date.now() - hit.t < 10 * 60 * 1000) items = hit.items; // never serve a cached "empty"
    } catch (e) {}
    if (!items) {
      for (const url of sources) {
        try {
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) continue;
          const json = await res.json();
          const got = json.data || [];
          // The archives have different coverage: PullPush can answer 200 with an empty
          // list for a user Arctic Shift has plenty of. An empty *first* page is
          // suspicious, so try the next source before concluding there's nothing.
          if (!got.length && !before && url !== sources[sources.length - 1]) { items = items || got; continue; }
          items = got;
          break;
        } catch (e) { /* network/parse error — try the next source */ }
      }
      if (!items) throw busyError();
      if (items.length) { try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items })); } catch (e) {} }
    }
    const last = items[items.length - 1];
    return {
      items,
      after: (last && items.length === limit) ? last.created_utc : null,
    };
  }

//fetch-comments
  async function fetchComments(username, after, sort, time, limit) {
    return fetchArchive("comment", username, after, limit);

    /* ── fallback (pre-2026-08-25 v2): direct /user/<name>/comments.json ──
       Used before switching to Arctic Shift above. Uncomment this block and
       comment out the block above to revert, if Arctic Shift ever stops working.
    sort = sort || "new";
    let url = ORIGIN + "/user/" + encodeURIComponent(username) + "/comments.json?limit=" + limit + "&sort=" + sort + "&raw_json=1";
    if (sort === "top" && time) url += "&t=" + time;
    if (after) url += "&after=" + encodeURIComponent(after);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    return {
      items: json.data.children.map(function(c) { return c.data; }),
      after: json.data.after || null,
    };
    */

    /* ── fallback (pre-2026-08-25 v1): search.json + per-thread hydration ──
       Used before switching to /user/<name>/comments.json above. Uncomment
       this block and comment out the blocks above to revert, if the direct
       listing endpoint ever stops working.
    sort = sort || "new";
    const q = encodeURIComponent('Author:"' + username + '"');
    let url = ORIGIN + "/search.json?q=" + q + "&type=comment&limit=25&sort=" + sort + "&raw_json=1";
    if (sort === "top" && time) url += "&t=" + time;
    if (after) url += "&after=" + encodeURIComponent(after);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    const stubs = json.data.children.map(function(c) { return c.data; });
    const cursor = json.data.after || null;
    const results = await Promise.all(stubs.map(function(s) { return hydrateStub(s, username); }));
    return { items: results.filter(function(c) { return c !== null; }), after: cursor };
    */
  }

  // Reddit's listing/search endpoints cap `limit` at 100 and paginate via an opaque
  // `after` cursor — there's no single request that returns "everything", so this
  // walks every page (100 at a time) up front and hands back the full list.
  async function fetchAllItems(tab, username, sort, time, onProgress, onFirstPage, onLaterPage) {
    let after = null, pages = 0, all = [];
    // Posts and comments: just the latest 100 (one request each) for now — no walking
    // older history. Raise this to load more pages (the cursor paging is already in place).
    const MAX_PAGES = 1;
    do {
      const result = tab === "posts"
        ? await fetchPosts(username, after, sort, time, 100)
        : await fetchComments(username, after, sort, time, 100);
      all = all.concat(result.items);
      after = result.after;
      pages++;
      onProgress(all.length);
      // Progressive rendering: let the caller paint page 1 immediately instead of
      // waiting for the full history; later pages stream in behind it.
      if (pages === 1 && onFirstPage) onFirstPage(all);
      else if (pages > 1 && onLaterPage) onLaterPage(all);
    } while (after && pages < MAX_PAGES);
    return all;
  }

  /* ── insights: subreddit activity scan ── */
  // Insights used to run its own independent network scan of every post and comment
  // (see the commented-out functions below) even when the Posts/Comments tabs had
  // already fetched that exact same full history moments earlier. Now it just tallies
  // whichever raw items it's handed — loadInsights() decides whether those items come
  // from the tabs' cache or a fresh fetchAllItems() call.
  function tallySubreddits(postItems, commentItems) {
    const subs = new Map();
    for (const item of postItems) {
      const key = item.subreddit || "unknown";
      const entry = subs.get(key) || { posts: 0, comments: 0 };
      entry.posts++;
      subs.set(key, entry);
    }
    for (const item of commentItems) {
      const key = item.subreddit || "unknown";
      const entry = subs.get(key) || { posts: 0, comments: 0 };
      entry.comments++;
      subs.set(key, entry);
    }
    return { subs, totalPosts: postItems.length, totalComments: commentItems.length, cancelled: false };
  }

  /* ── fallback (pre-2026-08-25): Insights' own independent network scan ──
     Uncomment fetchSubredditPage/scanSubredditActivity/scanInsights below (and
     swap loadInsights() back to calling scanInsights()) to revert to Insights
     always doing its own full fetch instead of reusing the tabs' cache.

  async function fetchSubredditPage(kind, username, after) {
    if (kind === "comment") {
      let url = "https://arctic-shift.photon-reddit.com/api/comments/search?author=" + encodeURIComponent(username) + "&limit=100&sort=desc&meta-app=profile-unhider";
      if (after) url += "&before=" + encodeURIComponent(after);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) { const e = new Error("Rate limited — showing partial results"); e.rateLimited = true; throw e; }
      if (!res.ok) throw new Error("Arctic Shift API returned " + res.status);
      const json = await res.json();
      const items = json.data || [];
      const last = items[items.length - 1];
      return { items, after: (last && items.length === 100) ? last.created_utc : null };
    }

    let url = `${ORIGIN}/search.json?q=author%3A${encodeURIComponent(username)}&type=link&limit=100&sort=new`;
    if (after) url += "&after=" + encodeURIComponent(after);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429) { const e = new Error("Rate limited by Reddit — showing partial results"); e.rateLimited = true; throw e; }
    if (!res.ok) throw new Error("Reddit API returned " + res.status);
    const json = await res.json();
    return { items: json.data.children.map((c) => c.data), after: json.data.after || null };
  }

  async function scanSubredditActivity(kind, username, subs, onPage, shouldCancel) {
    let after = null, pages = 0, count = 0;
    const MAX_PAGES = 40;
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
  */

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
            <a class="rpu-subreddit" href="${ORIGIN}/r/${esc(p.subreddit)}/" target="_blank" rel="noopener">${esc(p.subreddit_name_prefixed || "r/" + p.subreddit)}</a>
            <span class="rpu-dot">·</span>
            <span>${timeAgo(p.created_utc)}</span>
            ${p.over_18 ? '<span class="rpu-nsfw-tag">NSFW</span>' : ""}
          </div>
          <a class="rpu-card-title" href="${ORIGIN}${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.title)}</a>
          <div class="rpu-card-footer">
            <span class="rpu-comments-count">${commentIcon(11)} ${p.num_comments || 0} comments</span>
          </div>
        </div>
      </div>`;
  }

  function renderComment(c) {
    // Reddit stores GIFs as markdown like ![gif](giphy|ID) and images as bare
    // preview.redd.it / i.redd.it links. Pull those out first (so the 300-char
    // truncation can't cut one in half) and render them as real <img>s.
    const media = [];
    let rawBody = (c.body || "")
      .replace(/!\[[^\]]*\]\(giphy\|([A-Za-z0-9]+)[^)]*\)/g, (m, id) => { media.push(`https://media.giphy.com/media/${id}/giphy.gif`); return ""; })
      .replace(/https?:\/\/(?:preview|i)\.redd\.it\/[^\s)]+/g, (u) => { media.push(u.replace(/&amp;/g, "&")); return ""; })
      .trim();
    const body = esc(rawBody.slice(0, 300)) + (rawBody.length > 300 ? "…" : "")
      + media.map((u) => `<img class="rpu-comment-img" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`).join("");
    const hasBody = rawBody.length > 0 || media.length > 0;
    const match = (c.permalink || "").match(/\/comments\/([a-z0-9]+)\/[^/]*\/([a-z0-9]+)/i);
    const commentUrl = match
      ? `${ORIGIN}/r/${esc(c.subreddit)}/comments/${match[1]}/_/${match[2]}/?context=3`
      : `${ORIGIN}${esc(c.permalink)}?context=3`;
    return `
      <div class="rpu-card rpu-comment-card">
        <div class="rpu-vote">${upArrow()}<span class="rpu-score">${fmtScore(c.score || 0)}</span></div>
        <div class="rpu-card-body">
          <div class="rpu-card-meta">
            <a class="rpu-subreddit" href="${ORIGIN}/r/${esc(c.subreddit)}/" target="_blank" rel="noopener">${esc(c.subreddit_name_prefixed || "r/" + c.subreddit)}</a>
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

  function renderInsightRows(entries, maxTotal, query) {
    if (!entries.length) {
      return `
        <div class="rpu-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${query ? `No activity in r/${esc(query)}` : "No activity found"}</span>
        </div>`;
    }
    return entries.map((e) => `
      <div class="rpu-insight-row">
        <div class="rpu-insight-row-main">
          <a class="rpu-insight-sub" href="${ORIGIN}/r/${esc(e.sub)}/" target="_blank" rel="noopener">r/${esc(e.sub)}</a>
          <div class="rpu-insight-bar-track">
            <div class="rpu-insight-bar-fill" style="width:${Math.max(4, Math.round((e.total / maxTotal) * 100))}%"></div>
          </div>
          <span class="rpu-insight-count">${e.total}</span>
        </div>
        <div class="rpu-insight-split">${e.posts} posts · ${e.comments} comments</div>
      </div>`).join("");
  }

  function insightEntries(data) {
    return Array.from(data.subs.entries())
      .map(([sub, c]) => ({ sub, posts: c.posts, comments: c.comments, total: c.posts + c.comments }))
      .sort((a, b) => b.total - a.total);
  }

  function renderInsights(data) {
    const entries = insightEntries(data);
    const maxTotal = entries.length ? entries[0].total : 1;

    return `
      <div class="rpu-insight-summary">
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${entries.length}</span><span class="rpu-insight-stat-label">subreddits</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalPosts}</span><span class="rpu-insight-stat-label">posts</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalComments}</span><span class="rpu-insight-stat-label">comments</span></div>
      </div>
      ${entries.length ? `
      <div class="rpu-insight-search-wrap">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="rpu-insight-search" id="rpu-insight-search" placeholder="Search subreddit…" autocomplete="off" />
      </div>` : ""}
      <p class="rpu-insight-note">Based on the latest 100 posts and latest 100 comments.</p>
      ${data.cancelled ? `<p class="rpu-insight-note">Scan stopped early (rate limited) — showing partial results.</p>` : ""}
      <div class="rpu-insight-list" id="rpu-insight-list">${renderInsightRows(entries, maxTotal, "")}</div>`;
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
        <div class="rpu-head-actions">
          <button class="rpu-close-btn" id="rpu-theme" title="Switch light / dark mode">${themeIcon()}</button>
          <button class="rpu-close-btn" id="rpu-close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
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
      </div>`;
    return panel;
  }

  /* ── inject ── */
  function inject(username) {
    if (document.getElementById("rpu-trigger-wrap")) return;

    window.__rpuInjected = true;
    trackProfile(username);

    // Disclaimer in profile header
    const profileMain = IS_OLD_REDDIT
      ? (document.querySelector('div.content[role="main"]') || document.querySelector("div.content"))
      : document.querySelector('[data-testid="profile-main"], div.px-md.relative.pt-md');
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
            <span class="rpu-disclaimer-body">Posts &amp; comments are sourced from Reddit's public search index. Only publicly visible content is shown. <a class="rpu-disclaimer-link" href="https://profile-unhider.vercel.app/privacy" target="_blank" rel="noopener">Privacy policy</a></span>
          </div>
        </div>`;
      if (IS_OLD_REDDIT) {
        // Old Reddit has no profile header card to attach to — put the notice at the
        // top of the column, right under the sort bar, like the redesign's header.
        const menu = profileMain.querySelector(".menuarea");
        if (menu) menu.after(disclaimer); else profileMain.prepend(disclaimer);
      } else {
        profileMain.appendChild(disclaimer);
      }
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

    // Old Reddit: sit directly under the sort bar rather than wherever the notice
    // happens to be (there can be a lot of empty space between the two).
    const oldMenu = IS_OLD_REDDIT && document.querySelector("div.content .menuarea");
    const oldAfter = oldMenu && document.getElementById("rpu-disclaimer") ? document.getElementById("rpu-disclaimer") : oldMenu;
    if (oldAfter && oldAfter.parentElement === anchor.parentElement) oldAfter.after(triggerWrap);
    else anchor.parentElement.insertBefore(triggerWrap, anchor);
    anchor.style.display = "none";

    let panelEl = null;
    let panelOpen = false;
    const PAGE_SIZE = 25;
    const INSIGHT_COMMENT_LIMIT = 100;
    const state = {
      activeTab: "posts",
      sort: "new",
      time: "all",
      posts: { items: [], loaded: false, fullyLoaded: false, loading: false, page: 0, fetchId: 0 },
      comments: { items: [], loaded: false, fullyLoaded: false, loading: false, page: 0, fetchId: 0 },
      insights: { loaded: false, loading: false, data: null },
    };

    const getEl = (id) => document.getElementById(id);

    function showLoading(msg, sub) {
      const el = getEl("rpu-loading");
      if (el) { el.style.display = "flex"; el.innerHTML = `<div class="rpu-spinner"></div><span>${esc(msg)}${sub ? `<span class="rpu-loading-sub">${esc(sub)}</span>` : ""}</span>`; }
    }
    function hideLoading() {
      const el = getEl("rpu-loading");
      if (el) el.style.display = "none";
    }

    function clearContent() {
      const content = getEl("rpu-content");
      if (content) content.querySelectorAll(".rpu-card, .rpu-empty, .rpu-error, .rpu-insight-summary, .rpu-insight-search-wrap, .rpu-insight-list, .rpu-insight-note").forEach((el) => el.remove());
    }

    function itemMatches(tab, item, q) {
      if (tab === "posts") {
        return (item.title || "").toLowerCase().includes(q) || (item.selftext || "").toLowerCase().includes(q);
      }
      return (item.body || "").toLowerCase().includes(q) || (item.link_title || "").toLowerCase().includes(q);
    }

    // The archives only order by time, so "Hot"/"Top" have nothing server-side
    // to request — instead just re-sort the already-fetched full list by score. "New" and
    // "Relevance" keep the API's chronological order (there's no real relevance signal
    // without a search query to be relevant to).
    function sortedItems(tab) {
      let items = state[tab].items;
      // "Top" + a time window (Today / This week / …) filters by age, like Reddit's own.
      if (state.sort === "top" && state.time !== "all") {
        const span = { day: 86400, week: 604800, month: 2592000, year: 31536000 }[state.time];
        if (span) { const cutoff = Date.now() / 1000 - span; items = items.filter((i) => i.created_utc >= cutoff); }
      }
      if (state.sort === "hot" || state.sort === "top") {
        return [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
      }
      return items;
    }

    function updatePagination(tab, totalPages) {
      const wrap = getEl("rpu-pagination");
      if (totalPages <= 1) { wrap.style.display = "none"; return; }
      wrap.style.display = "flex";
      getEl("rpu-page-info").textContent = `Page ${state[tab].page + 1} of ${totalPages}`;
      getEl("rpu-prev-page").disabled = state[tab].page === 0;
      getEl("rpu-next-page").disabled = state[tab].page >= totalPages - 1;
    }

    // Renders the current page of the active tab's already-fully-fetched items,
    // applying the search box filter first. Safe to call on every keystroke/page
    // change since it has no fetch or stat-tracking side effects.
    function renderItems() {
      const tab = state.activeTab;
      const items = sortedItems(tab);
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
        getEl("rpu-pagination").style.display = "none";
        return;
      }

      const query = (getEl("rpu-item-search").value || "").trim().toLowerCase();
      const filtered = query ? items.filter((item) => itemMatches(tab, item, query)) : items;
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      state[tab].page = Math.min(Math.max(state[tab].page, 0), totalPages - 1);
      const pageItems = filtered.slice(state[tab].page * PAGE_SIZE, (state[tab].page + 1) * PAGE_SIZE);

      if (pageItems.length === 0) {
        content.insertAdjacentHTML("beforeend", `
          <div class="rpu-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>No ${tab} matching "${esc(query)}"</span>
          </div>`);
      } else {
        const html = pageItems.map((item) => tab === "posts" ? renderPost(item) : renderComment(item)).join("");
        content.insertAdjacentHTML("beforeend", html);
      }
      updatePagination(tab, totalPages);
    }

    async function loadTab(tab) {
      state.activeTab = tab;
      panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
        btn.classList.toggle("rpu-tab-active", btn.dataset.tab === tab);
      });
      getEl("rpu-item-search").value = "";
      getEl("rpu-pagination").style.display = "none";
      if (tab === "insights") { await loadInsights(); return; }
      if (state[tab].loaded) { state[tab].page = 0; renderItems(); return; }
      if (state[tab].loading) return; // a fetch for this tab is already in flight
      state[tab].loading = true;
      state[tab].fullyLoaded = false;
      const fetchId = ++state[tab].fetchId; // stale callbacks from a superseded fetch no-op
      const isCurrent = () => state[tab].fetchId === fetchId && state.activeTab === tab;
      clearContent();
      showLoading(tab === "comments" ? "Fetching comments…" : "Fetching posts…");
      try {
        const items = await fetchAllItems(tab, username, state.sort, state.time, (count) => {
          if (isCurrent() && !state[tab].loaded) showLoading(`Fetching ${tab}… (${count} found)`);
        }, (firstPage) => {
          // First page is in — paint it now instead of waiting for the full history.
          if (!isCurrent()) return;
          state[tab].items = firstPage;
          state[tab].loaded = true;
          state[tab].page = 0;
          renderItems();
        }, (grown) => {
          // Later pages stream in behind the rendered content.
          if (!isCurrent() || !state[tab].loaded) return;
          state[tab].items = grown;
          renderItems();
        });
        if (state[tab].fetchId !== fetchId) return; // superseded mid-fetch; a newer fetch owns this tab now
        state[tab].items = items;
        state[tab].fullyLoaded = true;
        if (state.activeTab === tab) renderItems();
        if (tab === "posts") trackPosts(items.length);
      } catch (err) {
        if (state[tab].fetchId !== fetchId) return;
        // If later pages failed after the first already rendered, keep what's on
        // screen — the background fetch just stops. fullyLoaded stays false so
        // Insights won't tally a partial history.
        if (state[tab].loaded) return;
        if (state.activeTab === tab) {
          hideLoading();
          getEl("rpu-content").insertAdjacentHTML("beforeend", `
            <div class="rpu-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>${err.friendly ? esc(err.message) : `Failed to fetch ${tab}: ${esc(err.message)}`}</span>
            </div>`);
        }
      } finally {
        if (state[tab].fetchId === fetchId) state[tab].loading = false;
      }
    }

    async function loadInsights() {
      // Honest waiting room: a full-history scan takes a while on active profiles,
      // so say so and invite browsing other tabs — the scan keeps running behind them.
      const showScanWaiting = (detail) => showLoading(
        detail ? `Scanning subreddits… (${detail})` : "Scanning subreddits…",
        "Takes a while on active profiles — browse Posts & Comments meanwhile, it'll be ready when you're back."
      );
      if (state.insights.loaded) { renderInsightsView(); return; }
      if (state.insights.loading) { showScanWaiting(); return; } // scan already running — just re-show the waiting room
      clearContent();

      // Insights only looks at the user's latest 100 posts and latest 100 comments
      // (one request each) — it no longer walks their full history. Both tabs cache
      // exactly that newest-first page, so reuse it once loaded; otherwise fetch it.
      const canReusePosts = state.posts.fullyLoaded;
      const canReuseComments = state.comments.fullyLoaded;

      if (canReusePosts && canReuseComments) {
        state.insights.data = tallySubreddits(state.posts.items.slice(0, INSIGHT_COMMENT_LIMIT), state.comments.items.slice(0, INSIGHT_COMMENT_LIMIT));
        state.insights.loaded = true;
        renderInsightsView();
        return;
      }

      state.insights.loading = true;
      showScanWaiting();
      try {
        // Posts and comments are independent — fetch them concurrently instead of back-to-back.
        const [postItems, commentItems] = await Promise.all([
          canReusePosts
            ? state.posts.items.slice(0, INSIGHT_COMMENT_LIMIT)
            : fetchAllItems("posts", username, "new", "all", (count) => {
                if (state.activeTab === "insights") showScanWaiting(`posts, ${count} found`);
              }),
          canReuseComments
            ? state.comments.items.slice(0, INSIGHT_COMMENT_LIMIT)
            : fetchComments(username, null, "new", "all", INSIGHT_COMMENT_LIMIT).then((r) => r.items),
        ]);
        state.insights.data = tallySubreddits(postItems, commentItems);
        state.insights.loaded = true;
        if (state.activeTab === "insights") renderInsightsView();
        // else: browsed away mid-scan — the result is cached and renders on return
      } catch (err) {
        if (state.activeTab !== "insights") return;
        hideLoading();
        getEl("rpu-content").insertAdjacentHTML("beforeend", `
          <div class="rpu-error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${err.friendly ? esc(err.message) : `Failed to scan subreddits: ${esc(err.message)}`}</span>
          </div>`);
      } finally {
        state.insights.loading = false;
      }
    }

    function renderInsightsView() {
      clearContent();
      hideLoading();
      getEl("rpu-content").insertAdjacentHTML("beforeend", renderInsights(state.insights.data));
      const searchInput = getEl("rpu-insight-search");
      if (searchInput) searchInput.addEventListener("input", () => filterInsights(searchInput.value));
    }

    function filterInsights(query) {
      const data = state.insights.data;
      if (!data) return;
      const entries = insightEntries(data);
      const maxTotal = entries.length ? entries[0].total : 1;
      const q = query.trim().replace(/^r\//i, "").toLowerCase();
      const filtered = q ? entries.filter((e) => e.sub.toLowerCase().includes(q)) : entries;
      const list = getEl("rpu-insight-list");
      if (list) list.innerHTML = renderInsightRows(filtered, maxTotal, q);
    }

    function goToPage(delta) {
      const tab = state.activeTab;
      if (tab === "insights" || !state[tab].loaded) return;
      state[tab].page += delta;
      renderItems();
    }

    function resetTabState(tab) {
      state[tab].items = [];
      state[tab].loaded = false;
      state[tab].fullyLoaded = false;
      state[tab].page = 0;
    }

    function openPanel() {
      if (panelEl) return;
      panelEl = buildPanel(username);
      triggerWrap.after(panelEl);
      maybeShowRatingNudge();

      // Tab clicks
      panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          getEl("rpu-sort-bar").style.display = tab === "insights" ? "none" : "flex";
          // Comments are always chronological — the sort buttons are meaningless there
          panelEl.querySelector(".rpu-sort-options").style.display = tab === "comments" ? "none" : "flex";
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
          reapplySortOrRefetch();
        });
      });

      // Time filter change
      getEl("rpu-time-select").addEventListener("change", (e) => {
        state.time = e.target.value;
        reapplySortOrRefetch();
      });

      // Comments are fully cached client-side and PullPush only orders by time, so a
      // sort/time change there just re-sorts what's already loaded — no need to re-fetch.
      // Posts still hit Reddit's real search API, where a different sort is a different
      // result set, so those genuinely need a fresh fetch.
      function reapplySortOrRefetch() {
        const tab = state.activeTab;
        if (state[tab].loaded) {
          state[tab].page = 0;
          renderItems();
          return;
        }
        resetTabState(tab);
        loadTab(tab);
      }

      // Search within loaded posts/comments
      getEl("rpu-item-search").addEventListener("input", () => {
        state[state.activeTab].page = 0;
        renderItems();
      });

      // Pagination
      getEl("rpu-prev-page").addEventListener("click", () => goToPage(-1));
      getEl("rpu-next-page").addEventListener("click", () => goToPage(1));

      getEl("rpu-close").addEventListener("click", closePanel);
      getEl("rpu-theme").addEventListener("click", () => {
        chrome.storage.local.set({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
      });
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
