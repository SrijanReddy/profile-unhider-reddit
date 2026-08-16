chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "https://profile-unhider.netlify.app/welcome" });
  }
});
