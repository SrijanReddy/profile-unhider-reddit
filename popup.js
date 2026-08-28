(function () {
  "use strict";

  const toggle = document.getElementById("toggle");
  const statusBox = document.getElementById("status-box");
  const statusDot = document.getElementById("status-dot");
  const statusTitle = document.getElementById("status-title");
  const statusSub = document.getElementById("status-sub");
  const statProfiles = document.getElementById("stat-profiles");
  const statPosts = document.getElementById("stat-posts");
  const resetBtn = document.getElementById("reset-btn");
  const refreshBtn = document.getElementById("refresh-btn");

  const defaultView = document.getElementById("default-view");
  const whatsNewView = document.getElementById("whats-new-view");
  const wnBadge = document.getElementById("wn-badge");
  const wnTitle = document.getElementById("wn-title");
  const wnItems = document.getElementById("wn-items");
  const wnGotIt = document.getElementById("wn-got-it");

  /* ── What's new ── */
  chrome.storage.local.get(["showWhatsNew"], (res) => {
    if (!res.showWhatsNew) return;
    const version = chrome.runtime.getManifest().version;
    fetch(chrome.runtime.getURL("whats-new.json"))
      .then((r) => r.json())
      .then((data) => {
        const entry = data[version];
        if (entry) {
          renderWhatsNew(entry, version);
        } else {
          chrome.storage.local.remove("showWhatsNew");
        }
      })
      .catch(() => chrome.storage.local.remove("showWhatsNew"));
  });

  function renderWhatsNew(entry, version) {
    wnBadge.textContent = "UPDATED TO V" + version;
    wnTitle.textContent = entry.title || "What's new";
    wnItems.innerHTML = "";
    (entry.items || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = "wn-item";

      const icon = document.createElement("div");
      icon.className = "wn-item-icon";
      icon.textContent = item.icon || "✨";

      const text = document.createElement("div");
      text.className = "wn-item-text";
      const title = document.createElement("strong");
      title.textContent = item.title || "";
      const desc = document.createElement("span");
      desc.textContent = item.desc || "";
      text.appendChild(title);
      text.appendChild(desc);

      row.appendChild(icon);
      row.appendChild(text);
      wnItems.appendChild(row);
    });
    defaultView.style.display = "none";
    whatsNewView.style.display = "";
  }

  wnGotIt.addEventListener("click", () => {
    chrome.storage.local.remove("showWhatsNew");
    whatsNewView.style.display = "none";
    defaultView.style.display = "";
  });

  /* ── Load state ── */
  chrome.storage.local.get(["profilesRevealed", "postsSurfaced", "enabled"], (res) => {
    statProfiles.textContent = res.profilesRevealed || 0;
    statPosts.textContent = res.postsSurfaced || 0;
    const enabled = res.enabled !== false;
    if (!enabled) {
      toggle.classList.add("off");
      setStatus("disabled", "", "Extension disabled", "Click toggle to re-enable");
    } else {
      updatePageStatus();
    }
  });

  /* ── Toggle ── */
  toggle.addEventListener("click", () => {
    chrome.storage.local.get(["enabled"], (res) => {
      const nowEnabled = res.enabled === false;
      chrome.storage.local.set({ enabled: nowEnabled });
      toggle.classList.toggle("off", !nowEnabled);
      if (!nowEnabled) {
        setStatus("disabled", "", "Extension disabled", "Click toggle to re-enable");
      } else {
        updatePageStatus();
      }
    });
  });

  /* ── Refresh page ── */
  refreshBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
        window.close();
      }
    });
  });

  /* ── Reset stats ── */
  resetBtn.addEventListener("click", () => {
    chrome.storage.local.set({ profilesRevealed: 0, postsSurfaced: 0 }, () => {
      statProfiles.textContent = "0";
      statPosts.textContent = "0";
    });
  });

  /* ── Page status ── */
  function updatePageStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) { setStatus("idle", "", "No active tab", "Open Reddit to use this extension"); return; }
      const url = tabs[0].url || "";
      if (!url.includes("reddit.com")) { setStatus("idle", "", "Not a Reddit page", "Extension idle on this tab"); return; }
      if (!url.includes("reddit.com/user/")) { setStatus("active", "", "Active — watching", "Navigate to a Reddit profile to use"); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: "getStatus" }, (response) => {
        if (chrome.runtime.lastError) { setStatus("active", "", "Active — watching", "On a Reddit profile page"); return; }
        if (response && response.injected) {
          setStatus("detected", "detected", "Hidden profile detected", "Reveal button injected on this page");
        } else {
          setStatus("active", "", "Active — watching", "No hidden profile detected yet");
        }
      });
    });
  }

  function setStatus(dotClass, boxClass, title, sub) {
    statusDot.className = "status-dot " + dotClass;
    statusBox.className = "status-box " + boxClass;
    statusTitle.textContent = title;
    statusSub.textContent = sub;
  }
})();
