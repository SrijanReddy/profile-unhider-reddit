/* api.js — fetching posts and comments, archive servers, insights scan.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

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

/* ── network: one request at a time, two servers, health-aware ──
   Server 1 = Arctic Shift, Server 2 = PullPush. The user only ever sees "Server 1" /
   "Server 2" (never the service names). Requests are strictly serialized with a pause
   between them, because the free archives answer bursts with 403/429. A server that
   fails is put on a cooldown and the other one is used; both busy surfaces a friendly
   "a lot of traffic" error with a retry countdown. */
const REQUEST_GAP_MS = 1500;
const REQUEST_TIMEOUT_MS = 12000;
const BACKOFF_MS = [10000, 30000, 60000];
const net = {
  servers: [
    { n: 1, state: "ok", until: 0, fails: 0, ms: null,
      url: (kind, u, limit, before) => "https://arctic-shift.photon-reddit.com/api/" + (kind === "comment" ? "comments" : "posts") + "/search?author=" + u + "&limit=" + limit + "&sort=desc&meta-app=profile-unhider" + (before ? "&before=" + before : "") },
    { n: 2, state: "ok", until: 0, fails: 0, ms: null,
      url: (kind, u, limit, before) => "https://api.pullpush.io/reddit/search/" + (kind === "comment" ? "comment" : "submission") + "/?author=" + u + "&size=" + limit + "&sort=desc&sort_type=created_utc" + (before ? "&before=" + before : "") },
  ],
  preferred: 0,        // 0 = automatic (Server 1 first); 1 or 2 = the user picked one
  active: 0,           // server that answered the last request
  source: null,        // "cache" or a server number, for the footer
  failedOver: false,
  lastEnd: 0,
  chain: Promise.resolve(),
  listeners: new Set(),
};
const netNotify = () => net.listeners.forEach((f) => f());
const serverBusy = (s) => Date.now() < s.until;
const retryInSeconds = () => Math.max(0, Math.ceil((Math.min(...net.servers.map((s) => s.until)) - Date.now()) / 1000));

function busyError() {
  const e = new Error("A lot of traffic right now, please try again in a bit.");
  e.friendly = true;
  e.retryIn = retryInSeconds();
  return e;
}

function enqueue(task) {
  const run = net.chain.then(async () => {
    const wait = net.lastEnd + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await task(); } finally { net.lastEnd = Date.now(); }
  });
  net.chain = run.catch(() => {});
  return run;
}

function markFailure(s, res) {
  s.fails++;
  let wait = BACKOFF_MS[Math.min(s.fails - 1, BACKOFF_MS.length - 1)];
  const reset = res ? Number(res.headers.get("x-ratelimit-reset")) : 0; // seconds, when the server exposes it
  if (reset > 0 && reset < 600) wait = reset * 1000;
  s.until = Date.now() + wait;
  s.state = "busy";
}

async function requestFromServers(kind, u, limit, before) {
  const order = [...net.servers];
  if (net.preferred) order.sort((a, b) => (a.n === net.preferred ? -1 : 0) - (b.n === net.preferred ? -1 : 0));
  let emptyFirstPage = null;
  for (const s of order) {
    if (serverBusy(s)) continue;
    const t0 = Date.now(), ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(s.url(kind, u, limit, before), { headers: { Accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) { markFailure(s, res); netNotify(); continue; }
      const got = (await res.json()).data || [];
      s.state = "ok"; s.fails = 0; s.until = 0; s.ms = Date.now() - t0;
      // The archives have different coverage: one can answer 200 with an empty list for a
      // user the other has plenty of. An empty *first* page is suspicious, so try the other.
      if (!got.length && !before && s !== order[order.length - 1]) { emptyFirstPage = got; netNotify(); continue; }
      net.active = s.n; net.source = s.n; net.failedOver = s.n !== order[0].n;
      netNotify();
      return got;
    } catch (e) {
      markFailure(s, null); netNotify();
    } finally {
      clearTimeout(timer);
    }
  }
  if (emptyFirstPage) return emptyFirstPage;
  throw busyError();
}

// Shared by posts and comments. Pagination is time-cursor based: `after` holds the
// created_utc (unix seconds) of the last item from the previous page, passed back as
// `before`. Both archives cap page size at 100 and only order by time.
async function fetchArchive(kind, username, after, limit) {
  limit = Math.min(limit || 25, 100);
  const before = after ? encodeURIComponent(Math.floor(after)) : null;
  const u = encodeURIComponent(username);
  // Remember responses for a few minutes so reloading the profile or reopening the
  // panel costs no requests. Never serve (or save) a cached "empty".
  const cacheKey = "rpu-" + kind + ":" + u + ":" + limit + ":" + (before || "");
  let items = null;
  try {
    const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (hit && hit.items.length && Date.now() - hit.t < 10 * 60 * 1000) { items = hit.items; net.source = "cache"; }
  } catch (e) {}
  if (!items) {
    items = await enqueue(() => requestFromServers(kind, u, limit, before));
    if (items.length) { try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items })); } catch (e) {} }
  }
  const last = items[items.length - 1];
  return { items, after: (last && items.length === limit) ? last.created_utc : null };
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
  return { subs, totalPosts: postItems.length, totalComments: commentItems.length, cancelled: false, postItems, commentItems };
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
