chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "https://profile-unhider.vercel.app/welcome" });
    // Seed lastSeenVersion so popup.js's own version check (see popup.js) never
    // shows the what's-new screen on a brand-new install — only on later updates.
    chrome.storage.local.set({ lastSeenVersion: chrome.runtime.getManifest().version });
  }

  /* ── fallback (pre-2026-08-31): showWhatsNew flag set on reason === "update" ──
     Replaced by a version-comparison check that popup.js runs on every open
     (see popup.js), since onInstalled's "update" reason turned out to be an
     unreliable trigger to depend on in some dev/reload setups (e.g. more than
     one copy of the unpacked extension loaded). Uncomment this to revert:
  else if (details.reason === "update") {
    chrome.storage.local.set({ showWhatsNew: true });
  }
  */
});
