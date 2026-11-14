/* renderers.js — rendering posts, comments, the activity heatmap,
   and the removed/deleted and NSFW labels and filters.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts); see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── renderers ── */
function upArrow() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff4500" stroke-width="2.5" style="display:block"><polyline points="18 15 12 9 6 15"/></svg>`;
}

function commentIcon(w) {
  return `<svg width="${w||11}" height="${w||11}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
}

/* ── removed / deleted labels ──
   Only from markers the archives actually carry, never guessed. Posts: the
   removed_by_category field (moderator / reddit / automod_filtered / deleted), or the
   archive's own removal_type note. Comments only have the removal_type note ("removed"
   covers mods and Reddit, which the data can't tell apart, or "deleted" for the user)
   and the [removed] / [deleted] text markers. No marker means no label, which is not
   the same as "not removed". */
const FLAGS = {
  mod:     { label: "Removed by mods" },
  reddit:  { label: "Removed by Reddit" },
  auto:    { label: "Filtered by AutoMod" },
  removed: { label: "Removed" },
  user:    { label: "Deleted by user" },
};
const FLAG_ICON = {
  user: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  other: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/></svg>',
};
function removalKind(item, kind) {
  const meta = item._meta || {};
  if (kind === "post") {
    switch (item.removed_by_category) {
      case "moderator": return "mod";
      case "reddit": return "reddit";
      case "automod_filtered": return "auto";
      case "deleted": case "author": return "user";
    }
    if (meta.removal_type === "moderator") return "mod";
    if (meta.removal_type === "reddit") return "reddit";
    if (meta.removal_type === "deleted" || item.selftext === "[deleted]") return "user";
    return null;
  }
  if (meta.removal_type === "deleted" || item.body === "[deleted]") return "user";
  if (meta.removal_type === "removed" || item.body === "[removed]") return "removed";
  return null;
}
// NSFW comes straight from the archive's over_18 field. On a comment it means the
// thread it was posted in is marked NSFW.
const nsfwPill = (item) => (item.over_18 === true ? '<span class="rpu-flag rpu-flag-nsfw">NSFW</span>' : "");
const flagPill = (k) => k ? `<span class="rpu-flag rpu-flag-${k}">${k === "user" ? FLAG_ICON.user : FLAG_ICON.other}${FLAGS[k].label}</span>` : "";

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
            ${nsfwPill(p)}
            ${flagPill(removalKind(p, "post"))}
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
            ${nsfwPill(c)}
            ${flagPill(removalKind(c, "comment"))}
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

/* ── activity heatmap (GitHub-style): one square per day, last 26 weeks ── */
const HEAT_WEEKS = 26;
const HEAT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayKey = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function renderHeat(data, metric) {
  const counts = new Map();
  let oldest = Infinity;
  const add = (items, k) => items.forEach((i) => {
    if (!i.created_utc) return;
    oldest = Math.min(oldest, i.created_utc);
    const key = dayKey(new Date(i.created_utc * 1000));
    const e = counts.get(key) || { p: 0, c: 0 };
    e[k]++; counts.set(key, e);
  });
  add(data.postItems || [], "p"); add(data.commentItems || [], "c");
  const val = (e) => (metric === "posts" ? e.p : metric === "comments" ? e.c : e.p + e.c);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - ((HEAT_WEEKS - 1) * 7 + today.getDay()));
  const firstLoaded = isFinite(oldest) ? new Date(oldest * 1000) : today; firstLoaded.setHours(0, 0, 0, 0);

  let cells = "", months = "", lastMonth = -1, total = 0, bestDay = null, bestVal = 0, run = 0, streak = 0, activeDays = 0;
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i % 7 === 0 && (d.getMonth() !== lastMonth) && (i === 0 || d.getDate() <= 7)) {
      lastMonth = d.getMonth();
      months += `<span style="left:${(i / 7 / HEAT_WEEKS) * 100}%">${HEAT_MONTHS[lastMonth]}</span>`;
    }
    if (d > today) { cells += `<i class="rpu-hc" style="visibility:hidden"></i>`; continue; }
    const e = counts.get(dayKey(d)) || { p: 0, c: 0 };
    const v = val(e), out = d < firstLoaded;
    if (!out) {
      total += v; if (v > 0) activeDays++;
      run = v > 0 ? run + 1 : 0; streak = Math.max(streak, run);
      if (v > bestVal) { bestVal = v; bestDay = d; }
    }
    const lvl = out || v === 0 ? "" : v === 1 ? " l1" : v <= 3 ? " l2" : v <= 5 ? " l3" : " l4";
    cells += `<i class="rpu-hc${lvl}${out ? " out" : ""}" data-d="${esc(dayLabel(d))}" data-p="${e.p}" data-c="${e.c}" data-out="${out ? 1 : 0}"></i>`;
  }
  const label = metric === "posts" ? "posts" : metric === "comments" ? "comments" : "posts and comments";
  const chip = (m, t) => `<span class="${metric === m ? "on" : ""}" data-hm="${m}">${t}</span>`;
  return `
      <div class="rpu-heat" id="rpu-heat">
        <div class="rpu-heat-top"><b>${total} ${label}</b><div class="rpu-heat-seg">${chip("all", "All")}${chip("posts", "Posts")}${chip("comments", "Comments")}</div></div>
        <div class="rpu-heat-grid">
          <div class="rpu-heat-days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
          <div class="rpu-heat-main"><div class="rpu-heat-months">${months}</div><div class="rpu-heat-cells">${cells}</div></div>
        </div>
        <div class="rpu-heat-detail" id="rpu-heat-detail">Hover a day for details</div>
        <div class="rpu-heat-foot"><span>Outlined days are older than the latest posts and comments we load.</span>
          <span class="rpu-heat-legend">Less <i class="rpu-hc"></i><i class="rpu-hc l1"></i><i class="rpu-hc l2"></i><i class="rpu-hc l3"></i><i class="rpu-hc l4"></i> More</span></div>
        <div class="rpu-heat-facts">
          <div><b>${bestDay ? esc(dayLabel(bestDay)) : "-"}</b>busiest day</div>
          <div><b>${streak} ${streak === 1 ? "day" : "days"}</b>longest streak</div>
          <div><b>${activeDays}</b>active days</div>
        </div>
      </div>`;
}

function renderRemovedSummary(data) {
  const counts = { mod: 0, reddit: 0, auto: 0, removed: 0, user: 0 };
  (data.postItems || []).forEach((p) => { const k = removalKind(p, "post"); if (k) counts[k]++; });
  (data.commentItems || []).forEach((c) => { const k = removalKind(c, "comment"); if (k) counts[k]++; });
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  if (!total) return "";
  const all = (data.postItems || []).length + (data.commentItems || []).length;
  const parts = ["mod", "reddit", "auto", "removed", "user"].filter((k) => counts[k]);
  return `
      <div class="rpu-removed">
        <div class="rpu-removed-top"><b>Removed and deleted</b><span>${total} of ${all} items</span></div>
        <div class="rpu-removed-bar">${parts.map((k) => `<i class="rpu-flag-bg-${k}" style="width:${(counts[k] / total) * 100}%"></i>`).join("")}</div>
        <div class="rpu-removed-legend">${parts.map((k) => `<div><i class="rpu-flag-bg-${k}"></i>${FLAGS[k].label}<b>${counts[k]}</b></div>`).join("")}</div>
        <div class="rpu-removed-fine">Only items the archive re-checked carry a label, so the real number can be higher.</div>
      </div>`;
}

function renderInsights(data, heatMetric) {
  const entries = insightEntries(data);
  const maxTotal = entries.length ? entries[0].total : 1;

  return `
      <div class="rpu-insight-summary">
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${entries.length}</span><span class="rpu-insight-stat-label">subreddits</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalPosts}</span><span class="rpu-insight-stat-label">posts</span></div>
        <div class="rpu-insight-stat"><span class="rpu-insight-stat-num">${data.totalComments}</span><span class="rpu-insight-stat-label">comments</span></div>
      </div>
      ${renderHeat(data, heatMetric || "all")}
      ${renderRemovedSummary(data)}
      ${entries.length ? `
    <div class="rpu-insight-search-wrap">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" class="rpu-insight-search" id="rpu-insight-search" placeholder="Search subreddit…" autocomplete="off" />
    </div>` : ""}
      <p class="rpu-insight-note">Based on the latest 100 posts and latest 100 comments.</p>
      <div class="rpu-insight-list" id="rpu-insight-list">${renderInsightRows(entries, maxTotal, "")}</div>`;
}
