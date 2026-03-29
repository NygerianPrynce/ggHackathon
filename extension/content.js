/**
 * Isolated-world helper: lightweight page signals for the service worker.
 * Heavy DOM work runs via MAIN-world injection from background.js (jQuery/Select2).
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_PAGE_INFO") {
    sendResponse({
      url: location.href,
      readyState: document.readyState,
    });
    return true;
  }
  return false;
});
