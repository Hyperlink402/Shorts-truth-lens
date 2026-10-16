document.addEventListener('DOMContentLoaded', () => {
  const mockModeEl = document.getElementById('mockMode');
  const apiKeyEl = document.getElementById('apiKey');
  const geminiModelEl = document.getElementById('geminiModel');
  const cacheExpirationEl = document.getElementById('cacheExpiration');
  const defaultCollapsedEl = document.getElementById('defaultCollapsed');
  const excludedListEl = document.getElementById('excludedList');
  const clearExcludedBtn = document.getElementById('clearExcludedBtn');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatusEl = document.getElementById('saveStatus');

  let excludedVideos = [];

  chrome.storage.sync.get(
    ['mockMode', 'apiKey', 'geminiModel', 'cacheExpiration', 'defaultCollapsed', 'excludedVideos'],
    (items) => {
      mockModeEl.checked = items.mockMode !== false;
      apiKeyEl.value = items.apiKey || '';
      geminiModelEl.value = items.geminiModel || 'gemini-1.5-flash';
      cacheExpirationEl.value = items.cacheExpiration || 3600;
      defaultCollapsedEl.checked = items.defaultCollapsed || false;
      excludedVideos = items.excludedVideos || [];
      renderExcludedList();
    }
  );

  function renderExcludedList() {
    excludedListListEl = ''; // typo fix
    excludedListEl.innerHTML = '';
    if (excludedVideos.length === 0) {
      excludedListEl.innerHTML = '<li style="color: #737373; text-align: center;">예외 처리된 영상이 없습니다.</li>';
      return;
    }
    excludedVideos.forEach((videoId) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>영상 ID: ${videoId}</span>
        <button data-id="${videoId}">삭제</button>
      `;
      li.querySelector('button').addEventListener('click', (e) => {
        const idToRemove = e.target.getAttribute('data-id');
        excludedVideos = excludedVideos.filter(id => id !== idToRemove);
        renderExcludedList();
      });
      excludedListEl.appendChild(li);
    });
  }

  clearExcludedBtn.addEventListener('click', () => {
    excludedVideos = [];
    renderExcludedList();
  });

  saveBtn.addEventListener('click', () => {
    const settings = {
      mockMode: mockModeEl.checked,
      apiKey: apiKeyEl.value.trim(),
      geminiModel: geminiModelEl.value.trim() || 'gemini-1.5-flash',
      cacheExpiration: parseInt(cacheExpirationEl.value, 10) || 3600,
      defaultCollapsed: defaultCollapsedEl.checked,
      excludedVideos: excludedVideos
    };

    chrome.storage.sync.set(settings, () => {
      saveStatusEl.textContent = 'Gemini 설정이 성공적으로 저장되었습니다!';
      setTimeout(() => {
        saveStatusEl.textContent = 'px';
      }, 2500);
    });
  });
});