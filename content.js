(() => {
  let currentVideoId = null;
  let analysisCache = new Map();
  let currentAbortController = null;
  let panelElement = null;
  let isCollapsed = false;
  let observer = null;
  let debounceTimer = null;
  const geminiClient = new GeminiVisionClient();

  function isShortsPage() {
    return window.location.pathname.startsWith('/shorts/');
  }

  function extractVideoId() {
    const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function createPanel() {
    if (panelElement) return;

    panelElement = document.createElement('div');
    panelElement.id = 'shorts-truth-lens-panel';
    panelElement.innerHTML = `
      <div class="stl-header" id="stl-drag-handle">
        <div class="stl-title">
          <span>🛡️</span> Shorts Truth Lens
        </div>
        <div class="stl-controls">
          <button class="stl-btn-icon" id="stl-toggle-btn" title="접기/펼치기">−</button>
        </div>
      </div>
      <div class="stl-body" id="stl-panel-body">
        <div class="stl-loading">영상 프레임 캡처 및 분석 대기 중...</div>
      </div>
      <div class="stl-status-bar">
        <span id="stl-status-time">대기 중</span>
        <span id="stl-mode-badge">Gemini Vision</span>
      </div>
    `;

    document.body.appendChild(panelElement);

    // 드래그 이동 기능 구현 (마우스로 창 위치 변경 가능)
    const header = document.getElementById('stl-drag-handle');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.addEventListener('mousedown', (e) => {
      // 버튼 클릭 시 드래그 방지
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panelElement.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      panelElement.style.transition = 'none'; // 드래그 중 애니메이션 제거
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panelElement.style.left = `${initialLeft + dx}px`;
      panelElement.style.top = `${initialTop + dy}px`;
      panelElement.style.right = 'auto'; // 고정 해제
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panelElement.style.transition = 'width 0.3s ease';
      }
    });

    document.getElementById('stl-toggle-btn').addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      panelElement.classList.toggle('collapsed', isCollapsed);
      document.getElementById('stl-toggle-btn').textContent = isCollapsed ? '+' : '−';
    });
  }

  function removePanel() {
    if (panelElement) {
      panelElement.remove();
      panelElement = null;
    }
  }

  function gatherVideoMetadata() {
    const titleEl = document.querySelector('ytd-reel-video-renderer[is-active] h2, #title h1, yt-formatted-string.ytd-watch-metadata');
    const channelEl = document.querySelector('ytd-reel-video-renderer[is-active] #text.ytd-channel-name, ytd-channel-name #text');
    
    const title = titleEl ? titleEl.textContent.trim() : document.title;
    const channel = channelEl ? channelEl.textContent.trim() : '알 수 없는 채널';

    return { title, channel };
  }

  async function captureShortsFrames() {
    const videoEl = document.querySelector('ytd-reel-video-renderer[is-active] video, video.html5-main-video');
    if (!videoEl) throw new Error('현재 쇼츠 비디오 요소를 찾을 수 없습니다.');

    const duration = videoEl.duration;
    if (!duration || isNaN(duration)) throw new Error('비디오 재생 정보를 읽을 수 없습니다.');

    const ratios = [0, 0.25, 0.5, 0.75, 0.95];
    const frames = [];
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');

    const originalPaused = videoEl.paused;
    videoEl.pause();

    for (const ratio of ratios) {
      videoEl.currentTime = duration * ratio;
      await new Promise((resolve) => {
        const onSeeked = () => {
          videoEl.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoEl.addEventListener('seeked', onSeeked);
        setTimeout(resolve, 300);
      });

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      frames.push(dataUrl.split(',')[1]);
    }

    if (!originalPaused) videoEl.play();
    return frames;
  }

  async function triggerAnalysis() {
    const videoId = extractVideoId();
    if (!videoId) return;

    if (!isShortsPage()) {
      removePanel();
      return;
    }

    createPanel();

    chrome.storage.sync.get(['excludedVideos', 'defaultCollapsed'], (data) => {
      if (data.excludedVideos && data.excludedVideos.includes(videoId)) {
        renderExcludedState();
        return;
      }
      if (data.defaultCollapsed !== undefined && !isCollapsed) {
        isCollapsed = data.defaultCollapsed;
        if (panelElement) panelElement.classList.toggle('collapsed', isCollapsed);
        const toggleBtn = document.getElementById('stl-toggle-btn');
        if (toggleBtn) toggleBtn.textContent = isCollapsed ? '+' : '−';
      }
    });

    if (analysisCache.has(videoId)) {
      renderResult(analysisCache.get(videoId));
      return;
    }

    renderLoadingState('영상의 핵심 프레임을 캡처하고 있습니다...');

    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    try {
      const frames = await captureShortsFrames();
      if (extractVideoId() !== videoId) return;

      renderLoadingState('Gemini 멀티모달 모델로 시각적 분석 중...');
      const { title, channel } = gatherVideoMetadata();

      const result = await geminiClient.analyzeShorts({ videoId, title, channel, frames });
      if (extractVideoId() !== videoId) return;

      analysisCache.set(videoId, result);
      renderResult(result);
    } catch (error) {
      if (error.name === 'AbortError') return;
      renderErrorState(error.message);
    }
  }

  function renderLoadingState(text) {
    const body = document.getElementById('stl-panel-body');
    if (!body) return;
    body.innerHTML = `<div class="stl-loading">${text}</div>`;
  }

  function renderExcludedState() {
    const body = document.getElementById('stl-panel-body');
    if (!body) return;
    const videoId = extractVideoId();
    body.innerHTML = `
      <div class="stl-section">
        <span class="stl-label">상태</span>
        <span class="stl-value">이 영상은 예외 목록에 등록되어 분석이 생략되었습니다.</span>
      </div>
      <div class="stl-footer-actions">
        <button class="stl-btn stl-btn-secondary" id="stl-unexclude-btn">예외 해제</button>
      </div>
    `;
    document.getElementById('stl-unexclude-btn').addEventListener('click', () => {
      chrome.storage.sync.get(['excludedVideos'], (data) => {
        const list = (data.excludedVideos || []).filter(id => id !== videoId);
        chrome.storage.sync.set({ excludedVideos: list }, () => {
          triggerAnalysis();
        });
      });
    });
  }

  function renderErrorState(errorMessage) {
    const body = document.getElementById('stl-panel-body');
    if (!body) return;
    body.innerHTML = `
      <div class="stl-section">
        <span class="stl-label">오류 발생</span>
        <span class="stl-value" style="color: #f87171;">${errorMessage}</span>
      </div>
      <div class="stl-footer-actions">
        <button class="stl-btn stl-btn-primary" id="stl-retry-btn">재시도</button>
      </div>
    `;
    document.getElementById('stl-retry-btn').addEventListener('click', () => {
      const videoId = extractVideoId();
      if (videoId) analysisCache.delete(videoId);
      triggerAnalysis();
    });
  }

  function getSlopBadgeClass(score) {
    if (score === '낮음') return 'low';
    if (score === '보통') return 'medium';
    if (score === '높음') return 'high';
    return 'unknown';
  }

  function renderResult(result) {
    const body = document.getElementById('stl-panel-body');
    if (!body) return;

    const timeEl = document.getElementById('stl-status-time');
    const modeBadgeEl = document.getElementById('stl-mode-badge');

    if (timeEl) timeEl.textContent = `분석 시각: ${result.analyzedAt}`;
    if (modeBadgeEl) modeBadgeEl.textContent = result.isMock ? 'Gemini Mock' : 'Gemini Vision';

    const videoId = extractVideoId();

    body.innerHTML = `
      ${result.isMock ? '<div class="stl-mock-notice">⚠️ 현재 Gemini Mock 모드로 작동 중입니다.</div>' : ''}
      <div class="stl-section">
        <span class="stl-label">현재 영상 제목</span>
        <span class="stl-value" style="font-weight: 500;">${escapeHtml(result.title)}</span>
      </div>
      <div class="stl-section">
        <span class="stl-label">채널명</span>
        <span class="stl-value">${escapeHtml(result.channel)}</span>
      </div>
      <div class="stl-section">
        <span class="stl-label">AI 생성 비디오 가능성</span>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="stl-value" style="font-weight: 600; font-size: 16px;">${result.aiGenerationScore}%</span>
        </div>
        <div class="stl-progress-container">
          <div class="stl-progress-bar" style="width: ${result.aiGenerationScore}%;"></div>
        </div>
      </div>
      <div class="stl-section">
        <span class="stl-label">AI 슬롭 분류</span>
        <div><span class="stl-badge ${getSlopBadgeClass(result.aiSlopScore)}">${result.aiSlopScore}</span></div>
      </div>
      <div class="stl-section">
        <span class="stl-label">정보 신뢰도 판정</span>
        <span class="stl-value" style="font-weight: 500; color: #60a5fa;">${escapeHtml(result.reliabilityVerdict)}</span>
      </div>
      <div class="stl-section">
        <span class="stl-label">프레임 분석 근거 요약</span>
        <span class="stl-value" style="font-size: 13px; color: #cccccc; line-height: 1.4;">${escapeHtml(result.verdictReason)}</span>
      </div>
      <div class="stl-footer-actions">
        <button class="stl-btn stl-btn-secondary" id="stl-retry-btn">재분석</button>
        <button class="stl-btn stl-btn-secondary" id="stl-exclude-btn" title="이 영상을 예외 목록에 추가">예외 추가</button>
      </div>
    `;

    document.getElementById('stl-retry-btn').addEventListener('click', () => {
      if (videoId) analysisCache.delete(videoId);
      triggerAnalysis();
    });

    document.getElementById('stl-exclude-btn').addEventListener('click', () => {
      if (!videoId) return;
      chrome.storage.sync.get(['excludedVideos'], (data) => {
        const list = data.excludedVideos || [];
        if (!list.includes(videoId)) {
          list.push(videoId);
          chrome.storage.sync.set({ excludedVideos: list }, () => {
            renderExcludedState();
          });
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  function debouncedTrigger() {
    if (!isShortsPage()) {
      removePanel();
      return;
    }
    const newVideoId = extractVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      currentVideoId = newVideoId;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        triggerAnalysis();
      }, 500);
    }
  }

  function initObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      debouncedTrigger();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('popstate', () => {
      debouncedTrigger();
    });

    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event('popstate'));
      debouncedTrigger();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('popstate'));
      debouncedTrigger();
    };
  }

  if (isShortsPage()) {
    currentVideoId = extractVideoId();
    triggerAnalysis();
  }
  initObserver();

})();