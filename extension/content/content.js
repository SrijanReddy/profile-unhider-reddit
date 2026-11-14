/* content.js — entry point: injection, the Posts/Comments/Insights
   pipeline, SPA watching, and the popup status listener.
   Part of the Profile Unhider content script. Loaded from manifest.json
   (content_scripts) last; see docs/ARCHITECTURE.md for load order. */
"use strict";

/* ── inject ── */
// Reddit is a single-page app: it can drop our Reveal box / panel and change the URL,
// after which we inject again. The previous copy's code (and its once-a-second timer)
// is still alive, so exactly one copy may be live at a time, and data already loaded
// for the same user is kept so the fresh copy has nothing to refetch.
let liveInstance = null;
const loadedData = { user: null, posts: null, comments: null };

function inject(username) {
  if (document.getElementById("rpu-trigger-wrap")) return;
  if (liveInstance) liveInstance.destroy(); // stop the previous copy before creating a new one
  let destroyed = false;

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
            <span class="rpu-disclaimer-body">Posts &amp; comments are sourced from public archives. Only publicly visible content is shown. <a class="rpu-disclaimer-link" href="https://profile-unhider.vercel.app/privacy" target="_blank" rel="noopener">Privacy policy</a></span>
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
        <div class="rpu-trigger-sub">Shows posts &amp; comments from public archives</div>
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
  const step = (items) => ({ items: items || [], loaded: !!items, fullyLoaded: !!items, loading: false, page: 0, fetchId: 0, error: null, retries: 0, retryAt: 0, retryTimer: null });
  const kept = loadedData.user === username ? loadedData : { posts: null, comments: null };
  const state = {
    activeTab: "posts",
    sort: "new",
    time: "all",
    heatMetric: "all",
    flagOnly: false,
    nsfwOnly: false,
    posts: step(kept.posts),
    comments: step(kept.comments),
    insights: { loaded: false, loading: false, data: null },
  };
  let ticker = null;

  // Elements are looked up inside THIS copy's own panel / Reveal box, never page-wide,
  // so a stray copy can't read or write another copy's elements.
  const getEl = (id) => (panelEl && panelEl.querySelector("#" + id)) || triggerWrap.querySelector("#" + id);

  liveInstance = {
    destroy() {
      destroyed = true;
      clearInterval(ticker); ticker = null;
      [state.posts, state.comments].forEach((st) => clearTimeout(st.retryTimer));
      net.listeners.delete(refreshChrome);
      if (panelEl) { panelEl.remove(); panelEl = null; }
    },
  };

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
    if (content) content.querySelectorAll(".rpu-card, .rpu-empty, .rpu-error, .rpu-insight-summary, .rpu-heat, .rpu-removed, .rpu-insight-search-wrap, .rpu-insight-list, .rpu-insight-note").forEach((el) => el.remove());
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
    const kindOf = tab === "posts" ? "post" : "comment";
    const flaggedCount = items.filter((i) => removalKind(i, kindOf)).length;
    const nsfwCount = items.filter((i) => i.over_18 === true).length;
    if (!flaggedCount) state.flagOnly = false;
    if (!nsfwCount) state.nsfwOnly = false;
    const chip = getEl("rpu-flag-filter");
    if (chip) { chip.hidden = !flaggedCount; chip.classList.toggle("on", state.flagOnly); getEl("rpu-flag-count").textContent = flaggedCount; }
    const nchip = getEl("rpu-nsfw-filter");
    if (nchip) { nchip.hidden = !nsfwCount; nchip.classList.toggle("on", state.nsfwOnly); getEl("rpu-nsfw-count").textContent = nsfwCount; }
    let filtered = query ? items.filter((item) => itemMatches(tab, item, query)) : items;
    if (state.flagOnly) filtered = filtered.filter((i) => removalKind(i, kindOf)); // both chips on = items that are both
    if (state.nsfwOnly) filtered = filtered.filter((i) => i.over_18 === true);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state[tab].page = Math.min(Math.max(state[tab].page, 0), totalPages - 1);
    const pageItems = filtered.slice(state[tab].page * PAGE_SIZE, (state[tab].page + 1) * PAGE_SIZE);

    if (pageItems.length === 0) {
      content.insertAdjacentHTML("beforeend", `
          <div class="rpu-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${query ? `No ${tab} matching "${esc(query)}"` : state.nsfwOnly && state.flagOnly ? `No removed or deleted NSFW ${tab}` : state.nsfwOnly ? `No NSFW ${tab}` : `No removed or deleted ${tab}`}</span>
          </div>`);
    } else {
      const html = pageItems.map((item) => tab === "posts" ? renderPost(item) : renderComment(item)).join("");
      content.insertAdjacentHTML("beforeend", html);
    }
    updatePagination(tab, totalPages);
  }

  /* ── the one-way pipeline: Posts, then Comments, then Insights ──
     Comments only start (and unlock) once Posts are in; Insights only unlocks once
     both are in and is built from them, so it never makes a request of its own. */
  const mmss = (sec) => Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  const STEP_LABEL = { posts: "posts", comments: "comments" };

  function tabInfo() {
    const P = state.posts, C = state.comments, I = state.insights;
    return {
      posts: { locked: false, tag: P.loaded ? String(P.items.length) : P.error ? "paused" : "loading", cls: P.loaded ? "ok" : P.error ? "" : "busy" },
      comments: {
        locked: !P.loaded,
        tag: C.loaded ? String(C.items.length) : !P.loaded ? "after Posts" : C.error ? "paused" : "loading",
        cls: C.loaded ? "ok" : P.loaded && !C.error ? "busy" : "",
      },
      insights: {
        locked: !(P.loaded && C.loaded),
        tag: I.loaded ? `${I.data.subs.size} subs` : P.loaded && C.loaded ? "building" : "after Comments",
        cls: I.loaded ? "ok" : "",
      },
    };
  }

  function renderTabs() {
    if (!panelEl) return;
    const info = tabInfo();
    panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
      const t = btn.dataset.tab, i = info[t];
      btn.classList.toggle("rpu-tab-locked", i.locked);
      btn.setAttribute("aria-disabled", i.locked ? "true" : "false");
      btn.title = i.locked ? (t === "comments" ? "Unlocks when Posts finish loading" : "Unlocks when Posts and Comments finish loading") : "";
      const tag = getEl("rpu-tag-" + t);
      if (tag) { tag.textContent = i.tag; tag.className = "rpu-tab-tag" + (i.cls ? " " + i.cls : ""); }
    });
  }

  function serverStatus(s) {
    if (serverBusy(s)) return { dot: "bad", text: "Busy · retry " + mmss(Math.ceil((s.until - Date.now()) / 1000)) };
    if (net.active === s.n && s.ms != null) return { dot: "ok", text: "Online · " + s.ms + " ms" };
    return { dot: "idle", text: s.ms != null ? "Standby" : "Ready" };
  }

  function renderServers() {
    const el = getEl("rpu-servers");
    if (!el) return;
    const mk = (s) => {
      const st = serverStatus(s), on = (net.preferred || net.active || 1) === s.n;
      return `<button class="rpu-srv${on ? " on" : ""}" data-server="${s.n}" title="Use Server ${s.n}"><i class="rpu-dot ${st.dot}"></i>Server ${s.n}<small>${st.text}</small></button>`;
    };
    el.innerHTML = `<span class="rpu-srv-label">Server</span>${net.servers.map(mk).join("")}`;
  }

  function renderNotice() {
    const el = getEl("rpu-notice");
    if (!el) return;
    const busy = net.servers.filter(serverBusy);
    if (busy.length === 1 && net.failedOver) {
      el.hidden = false;
      el.innerHTML = `<b>Server ${busy[0].n} is busy. Using Server ${net.active}.</b><span>We'll check Server ${busy[0].n} again in ${mmss(Math.ceil((busy[0].until - Date.now()) / 1000))}. Nothing for you to do.</span>`;
    } else { el.hidden = true; el.innerHTML = ""; }
  }

  function renderFooter() {
    const el = getEl("rpu-footer");
    if (!el) return;
    const P = state.posts, C = state.comments;
    const err = P.error || C.error;
    let dot, html;
    if (err) { dot = "bad"; html = `Not loading? <a data-act="switch">Switch server</a>`; }
    else if (P.loaded && C.loaded) {
      dot = "ok";
      html = net.source === "cache" ? "Loaded from saved results · refreshed every 10 min" : `Loaded from Server ${net.source || net.active || 1} · saved for 10 min`;
    } else {
      dot = "warn";
      html = `${!P.loaded ? "Loading posts" : "Loading comments"}, one request at a time · <a data-act="switch">Switch server</a>`;
    }
    el.innerHTML = `<i class="rpu-dot ${dot}"></i><span>${html}</span>`;
  }

  function updateCountdowns() {
    panelEl.querySelectorAll(".rpu-count").forEach((el) => {
      const st = state[el.dataset.tab];
      el.textContent = mmss(Math.max(0, Math.ceil((st.retryAt - Date.now()) / 1000)));
    });
  }

  function refreshChrome() {
    if (!panelEl) return;
    if (!panelEl.isConnected) { closePanel(); return; } // Reddit removed our panel: stop ticking
    renderTabs(); renderServers(); renderNotice(); renderFooter(); updateCountdowns();
  }

  function renderStepError(tab, err) {
    const st = state[tab];
    const auto = err.friendly && st.retryAt > Date.now();
    const other = (net.preferred || net.active || 1) === 1 ? 2 : 1;
    getEl("rpu-content").insertAdjacentHTML("beforeend", `
        <div class="rpu-error">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span><b>${err.friendly ? "A lot of traffic right now." : "Couldn't load " + STEP_LABEL[tab] + "."}</b>
            ${auto ? `<span class="rpu-loading-sub">Trying again automatically in <span class="rpu-count" data-tab="${tab}">${mmss(Math.ceil((st.retryAt - Date.now()) / 1000))}</span>.</span>` : `<span class="rpu-loading-sub">Please try again in a bit.</span>`}</span>
          <div class="rpu-error-actions">
            <button class="rpu-btn pri" data-act="retry" data-tab="${tab}">Try again now</button>
            <button class="rpu-btn" data-act="switch">Switch to Server ${other}</button>
          </div>
        </div>`);
  }

  function skeletonHtml() {
    return Array.from({ length: 2 }, () => `<div class="rpu-skel-card"><i class="rpu-skel" style="width:14px;height:14px"></i><i class="rpu-skel" style="height:44px"></i><div><i class="rpu-skel" style="height:9px;width:30%"></i><i class="rpu-skel" style="height:9px;width:92%"></i><i class="rpu-skel" style="height:9px;width:55%"></i></div></div>`).join("");
  }

  function showStepLoading(tab) {
    showLoading(
      tab === "comments" ? "Fetching comments…" : "Fetching posts…",
      tab === "posts" ? "Comments start right after, one request at a time." : "Insights builds as soon as these finish."
    );
    const el = getEl("rpu-loading");
    if (el) el.insertAdjacentHTML("beforeend", `<div class="rpu-skel-wrap">${skeletonHtml()}</div>`);
  }

  function scheduleRetry(tab, err) {
    const st = state[tab];
    clearTimeout(st.retryTimer);
    if (!err.friendly || st.retries >= 3) { st.retryAt = 0; return; }
    const wait = Math.max(5, err.retryIn || 10) * 1000;
    st.retryAt = Date.now() + wait;
    st.retryTimer = setTimeout(() => { st.retries++; retryStep(tab, false); }, wait);
  }

  function retryStep(tab, manual) {
    const st = state[tab];
    clearTimeout(st.retryTimer);
    if (manual) { st.retries = 0; net.servers.forEach((s) => { s.until = 0; s.fails = 0; s.state = "ok"; }); }
    st.error = null;
    if (state.activeTab === tab) { clearContent(); showStepLoading(tab); }
    ensureData(tab);
  }

  async function ensureData(tab) {
    const st = state[tab];
    if (st.loaded || st.loading) return;
    st.loading = true; st.error = null; st.fullyLoaded = false;
    const fetchId = ++st.fetchId;
    refreshChrome();
    try {
      const items = await fetchAllItems(tab, username, "new", "all", () => {});
      if (st.fetchId !== fetchId || destroyed) return; // superseded, or this copy was replaced
      loadedData.user = username; loadedData[tab] = items;
      st.items = items; st.loaded = true; st.fullyLoaded = true; st.page = 0; st.retries = 0;
      if (tab === "posts") trackPosts(items.length);
      if (state.activeTab === tab) renderItems();
      if (tab === "posts") ensureData("comments");   // posts are in: start comments
      else maybeBuildInsights();                      // comments are in: build insights
    } catch (err) {
      if (st.fetchId !== fetchId || destroyed) return;
      st.error = err;
      scheduleRetry(tab, err);
      if (state.activeTab === tab) { hideLoading(); clearContent(); renderStepError(tab, err); }
    } finally {
      if (st.fetchId === fetchId) st.loading = false;
      refreshChrome();
    }
  }

  function maybeBuildInsights() {
    const P = state.posts, C = state.comments, I = state.insights;
    if (I.loaded || !P.loaded || !C.loaded) return;
    I.data = tallySubreddits(P.items.slice(0, INSIGHT_COMMENT_LIMIT), C.items.slice(0, INSIGHT_COMMENT_LIMIT));
    I.loaded = true;
    if (state.activeTab === "insights") renderInsightsView();
    refreshChrome();
  }

  // Shows a tab. Data is fetched by ensureData() in pipeline order, never by clicking:
  // this only displays what is there (or the loading / error state for that step).
  function loadTab(tab) {
    state.activeTab = tab;
    panelEl.querySelectorAll(".rpu-tab").forEach((btn) => btn.classList.toggle("rpu-tab-active", btn.dataset.tab === tab));
    getEl("rpu-item-search").value = "";
    state.flagOnly = false;
    state.nsfwOnly = false;
    getEl("rpu-pagination").style.display = "none";
    clearContent();
    if (tab === "insights") {
      if (state.insights.loaded) renderInsightsView();
      return;
    }
    const st = state[tab];
    if (st.loaded) { st.page = 0; renderItems(); return; }
    if (st.error) { hideLoading(); renderStepError(tab, st.error); return; }
    showStepLoading(tab);
    ensureData(tab); // no-op if already running
  }

  function renderInsightsView() {
    clearContent();
    hideLoading();
    getEl("rpu-content").insertAdjacentHTML("beforeend", renderInsights(state.insights.data, state.heatMetric));
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

  function openPanel() {
    if (panelEl) return;
    panelEl = buildPanel(username);
    triggerWrap.after(panelEl);
    maybeShowRatingNudge();

    // Tab clicks
    panelEl.querySelectorAll(".rpu-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (btn.classList.contains("rpu-tab-locked")) return; // Comments wait for Posts, Insights for both
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

    // Both tabs hold their full (single-page) result in memory and the archives only
    // order by time, so a sort/time change just re-sorts what is already loaded.
    function reapplySortOrRefetch() {
      const tab = state.activeTab;
      if (state[tab].loaded) { state[tab].page = 0; renderItems(); }
    }

    getEl("rpu-flag-filter").addEventListener("click", () => {
      state.flagOnly = !state.flagOnly;
      state[state.activeTab].page = 0;
      renderItems();
    });
    getEl("rpu-nsfw-filter").addEventListener("click", () => {
      state.nsfwOnly = !state.nsfwOnly;
      state[state.activeTab].page = 0;
      renderItems();
    });

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
      storageSet({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
    });

    // Server buttons, retry / switch actions, heatmap chips (all delegated: these
    // elements are re-rendered as the state changes).
    panelEl.addEventListener("click", (e) => {
      const srv = e.target.closest("[data-server]");
      if (srv) { net.preferred = Number(srv.dataset.server); refreshChrome(); return; }
      const act = e.target.closest("[data-act]");
      if (act) {
        const stuck = [["posts", state.posts], ["comments", state.comments]].find(([, st]) => st.error);
        if (act.dataset.act === "switch") {
          net.preferred = (net.preferred || net.active || 1) === 1 ? 2 : 1;
          if (stuck) retryStep(stuck[0], true);
          refreshChrome();
        } else if (act.dataset.act === "retry") retryStep(act.dataset.tab, true);
        return;
      }
      const hm = e.target.closest("[data-hm]");
      if (hm) {
        state.heatMetric = hm.dataset.hm;
        const card = getEl("rpu-heat");
        if (card && state.insights.data) card.outerHTML = renderHeat(state.insights.data, state.heatMetric);
      }
    });
    panelEl.addEventListener("mouseover", (e) => {
      const c = e.target.closest(".rpu-hc[data-d]");
      const out = getEl("rpu-heat-detail");
      if (!c || !out) return;
      out.textContent = c.dataset.out === "1"
        ? c.dataset.d + " · before the posts and comments we load"
        : `${c.dataset.d} · ${c.dataset.p} post${c.dataset.p === "1" ? "" : "s"}, ${c.dataset.c} comment${c.dataset.c === "1" ? "" : "s"}`;
    });

    net.listeners.add(refreshChrome);
    ticker = setInterval(refreshChrome, 1000); // server cooldown / retry countdowns
    refreshChrome();
    loadTab("posts");
    startPipeline();
  }

  // Starts whichever step is next. Safe to call any time: ensureData ignores a step
  // that is loaded or already running, and a step in an error state keeps its retry card.
  function startPipeline() {
    const P = state.posts, C = state.comments;
    if (!P.loaded) ensureData("posts");
    else if (!C.loaded && !C.loading && !C.error) ensureData("comments");
    maybeBuildInsights();
  }

  function closePanel() {
    net.listeners.delete(refreshChrome);
    clearInterval(ticker); ticker = null;
    [state.posts, state.comments].forEach((st) => clearTimeout(st.retryTimer));
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

/* ── Message listener for popup status queries ── */
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getStatus") {
    sendResponse({ injected: window.__rpuInjected === true });
  }
  return true;
});
}
