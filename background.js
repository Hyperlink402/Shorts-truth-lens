chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    {
      apiKey: '',
      geminiModel: 'gemini-1.5-flash',
      mockMode: true,
      cacheExpiration: 3600,
      defaultCollapsed: false,
      excludedVideos: []
    },
    (items) => {
      chrome.storage.sync.set(items);
    }
  );
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(null, (items) => {
      sendResponse(items);
    });
    return true;
  }
});