/* ── Uninstall feedback ──
   Open the leaving-only goodbye box when the extension is removed.
   Set on every background start, not only on install: Firefox does not
   persist the URL the way Chrome does, and re-setting it is harmless.
   Chrome opens it on removal; Firefox does too unless the extension was
   disabled first; Safari ignores the call. No new permission needed.
   The version rides in the hash query (?v=) so the site can tell which
   release someone left on; app.js reads it from either the hash or the
   query string. */
function refreshUninstallUrl() {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.setUninstallURL) return;
  var url = "https://profile-unhider.vercel.app/#goodbye?v=" + chrome.runtime.getManifest().version;
  try {
    var result = chrome.runtime.setUninstallURL(url);
    if (result && typeof result.catch === "function") result.catch(function () {});
  } catch (e) { /* older runtimes / Safari: no-op */ }
}
refreshUninstallUrl();

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
