const statusCache = new Map();

async function getVisibilityStatus(username) {
  if (statusCache.has(username)) return statusCache.get(username);
  const aboutRes = await fetch(`https://www.reddit.com/user/${username}/about.json`);
  const about = await aboutRes.json();
  if (about?.data?.is_suspended) { statusCache.set(username, 'suspended'); return 'suspended'; }
  const hasKarma = (about?.data?.link_karma ?? 0) + (about?.data?.comment_karma ?? 0) > 0;
  const [subRes, comRes] = await Promise.all([
    fetch(`https://www.reddit.com/user/${username}/submitted.json?limit=1`),
    fetch(`https://www.reddit.com/user/${username}/comments.json?limit=1`)
  ]);
  const [sub, com] = await Promise.all([subRes.json(), comRes.json()]);
  const hasVisiblePosts = (sub?.data?.children?.length ?? 0) > 0 || (com?.data?.children?.length ?? 0) > 0;
  let status = !hasKarma && !hasVisiblePosts ? 'no-activity' : (hasKarma && !hasVisiblePosts ? 'hidden' : 'public');
  statusCache.set(username, status);
  return status;
}

const BADGE_CONFIG = {
  checking: { text: 'Checking', bg: '#2a2a2b', color: '#818384' },
  hidden:   { text: 'Hidden',   bg: '#3a2415', color: '#f0997b' },
  public:   { text: 'Public',   bg: '#2a3a2a', color: '#97c459' },
  suspended:{ text: 'Suspended',bg: '#3a2020', color: '#e24b4a' },
  'no-activity': null
};

const PU_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="flex-shrink:0"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

function makeBadge(state, username) {
  const cfg = BADGE_CONFIG[state];
  const el = document.createElement(cfg ? 'a' : 'span');
  el.className = 'pu-badge';

  if (!cfg) { el.style.display = 'none'; return el; }

  if (username) {
    el.href = `https://www.reddit.com/user/${username}/`;
    el.target = '_blank';
    el.rel = 'noopener';
    el.title = 'via Profile Unhider — click to open profile';
  }

  el.style.cssText =
    'display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;' +
    `padding:2px 8px;border-radius:20px;margin-left:8px;` +
    `background:${cfg.bg};color:${cfg.color};` +
    `border:1px solid ${cfg.color};text-decoration:none;cursor:pointer;`;

  el.innerHTML = PU_ICON + `<span>${cfg.text}</span>`;
  if (state === 'checking') el.style.animation = 'pu-pulse 1s infinite';
  return el;
}

if (!document.getElementById('pu-badge-style')) {
  const style = document.createElement('style');
  style.id = 'pu-badge-style';
  style.textContent = '@keyframes pu-pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  document.head.appendChild(style);
}

function extractUsername(card) {
  const link = card.querySelector('faceplate-tracker[noun="user_profile"] a[href^="/user/"]');
  return link?.getAttribute('href')?.match(/\/user\/([^/]+)/)?.[1] ?? null;
}

async function handleHoverCard(card) {
  if (card.dataset.puHandled) return;
  card.dataset.puHandled = 'true';

  const username = extractUsername(card);
  const anchor = card.querySelector('faceplate-tracker[noun="user_profile"] a[href^="/user/"]')?.closest('.flex.items-center');
  if (!username || !anchor) return;

  const badge = makeBadge('checking', username);
  anchor.appendChild(badge);

  try {
    const status = await getVisibilityStatus(username);
    badge.replaceWith(makeBadge(status, username));
  } catch (e) {
    badge.remove();
  }
}

function scanForCards(root) {
  root.querySelectorAll?.('[data-testid="user-hover-card"]').forEach(handleHoverCard);
}

// watches a node's subtree AND attaches to any shadow roots that appear
function deepObserve(root) {
  scanForCards(root);
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('[data-testid="user-hover-card"]')) handleHoverCard(node);
        scanForCards(node);
        if (node.shadowRoot) deepObserve(node.shadowRoot);
        // catch elements whose shadowRoot attaches slightly later
        node.querySelectorAll?.('*').forEach(el => { if (el.shadowRoot) deepObserve(el.shadowRoot); });
      }
    }
  });
  obs.observe(root, { childList: true, subtree: true });
  return obs;
}

deepObserve(document.body);