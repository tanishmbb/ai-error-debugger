/**
 * AI Error Debugger - Content Script
 *
 * Injected into web pages to display the real-time AI diagnostic overlay.
 * Uses Shadow DOM to isolate styles completely:
 * - Page CSS cannot break the overlay.
 * - Overlay CSS cannot bleed into the host page.
 */

(function () {
  // Prevent duplicate execution if injected dynamically multiple times
  if (window.__aiErrorDebuggerInitialized) {
    return;
  }
  window.__aiErrorDebuggerInitialized = true;

  const HOST_ID = 'ai-error-debugger-root';
  const AUTO_DISMISS_MS = 20000; // 20 seconds auto-dismiss

  let currentHost = null;
  let shadowRoot = null;
  let dismissTimer = null;
  let currentSuggestionText = '';

  /**
   * Helper to escape HTML characters in dynamic strings
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Truncate URL for compact monospace display
   */
  function formatDisplayUrl(rawUrl) {
    if (!rawUrl) return 'unknown';
    try {
      const parsed = new URL(rawUrl);
      const pathWithQuery = parsed.pathname + parsed.search;
      return parsed.host + (pathWithQuery.length > 25 ? pathWithQuery.slice(0, 22) + '...' : pathWithQuery);
    } catch {
      return rawUrl.length > 32 ? rawUrl.slice(0, 29) + '...' : rawUrl;
    }
  }

  /**
   * Ensures the host container and open Shadow DOM are attached to document
   */
  function getOrCreateShadowRoot() {
    if (!currentHost || !document.contains(currentHost)) {
      currentHost = document.getElementById(HOST_ID);
      if (!currentHost) {
        currentHost = document.createElement('div');
        currentHost.id = HOST_ID;
        // Reset host container CSS completely
        currentHost.style.setProperty('all', 'initial', 'important');
        currentHost.style.setProperty('position', 'fixed', 'important');
        currentHost.style.setProperty('bottom', '24px', 'important');
        currentHost.style.setProperty('right', '24px', 'important');
        currentHost.style.setProperty('z-index', '2147483647', 'important');
        currentHost.style.setProperty('pointer-events', 'none', 'important'); // Inner overlay enables pointer events

        const targetParent = document.body || document.documentElement;
        if (targetParent) {
          targetParent.appendChild(currentHost);
        }
      }
      shadowRoot = currentHost.shadowRoot || currentHost.attachShadow({ mode: 'open' });
    }
    return shadowRoot;
  }

  /**
   * Inlines CSS styles directly inside Shadow DOM via a <style> tag
   */
  function getInlineStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      :host {
        all: initial;
        display: block;
      }

      .overlay-wrapper {
        pointer-events: auto;
        width: 360px;
        max-width: calc(100vw - 32px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 13.5px;
        line-height: 1.5;
        color: #f1f5f9;
        
        /* Glassmorphism styling */
        background: rgba(15, 20, 32, 0.82);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.55),
                    0 0 0 1px rgba(255, 255, 255, 0.05),
                    0 0 24px 2px rgba(99, 102, 241, 0.18);
        
        overflow: hidden;
        animation: slideIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        transition: opacity 0.24s ease, transform 0.24s ease;
      }

      .overlay-wrapper.fade-out {
        opacity: 0;
        transform: translateY(12px) scale(0.97);
        pointer-events: none;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(24px) scale(0.94);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* Light Theme Adaptation */
      @media (prefers-color-scheme: light) {
        .overlay-wrapper {
          color: #0f172a;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(15, 23, 42, 0.14);
          box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.18),
                      0 0 0 1px rgba(15, 23, 42, 0.04),
                      0 0 24px 2px rgba(99, 102, 241, 0.15);
        }
      }

      /* Header */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px 10px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      @media (prefers-color-scheme: light) {
        .header {
          border-bottom-color: rgba(15, 23, 42, 0.08);
        }
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        transition: background-color 0.2s ease;
      }

      .status-dot.loading {
        background: #6366f1;
        box-shadow: 0 0 10px #6366f1;
        animation: pulseDot 1.4s infinite ease-in-out;
      }

      .status-dot.error {
        background: #f43f5e;
        box-shadow: 0 0 8px rgba(244, 63, 94, 0.6);
      }

      @keyframes pulseDot {
        0%, 100% {
          transform: scale(0.9);
          opacity: 0.6;
        }
        50% {
          transform: scale(1.3);
          opacity: 1;
        }
      }

      .title {
        font-weight: 600;
        font-size: 13px;
        letter-spacing: -0.01em;
        text-transform: uppercase;
        background: linear-gradient(135deg, #a5b4fc 0%, #c084fc 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      @media (prefers-color-scheme: light) {
        .title {
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
      }

      .close-button {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s ease, background-color 0.15s ease;
      }

      .close-button:hover {
        color: #f1f5f9;
        background: rgba(255, 255, 255, 0.1);
      }

      @media (prefers-color-scheme: light) {
        .close-button {
          color: #64748b;
        }
        .close-button:hover {
          color: #0f172a;
          background: rgba(15, 23, 42, 0.08);
        }
      }

      /* Request Info Bar */
      .request-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(0, 0, 0, 0.2);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11.5px;
      }

      @media (prefers-color-scheme: light) {
        .request-bar {
          background: rgba(15, 23, 42, 0.04);
        }
      }

      .method {
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 10.5px;
      }

      .url-snippet {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #cbd5e1;
      }

      @media (prefers-color-scheme: light) {
        .url-snippet {
          color: #334155;
        }
      }

      .error-badge {
        padding: 2px 7px;
        border-radius: 9999px;
        font-size: 10.5px;
        font-weight: 600;
        white-space: nowrap;
      }

      .error-badge.badge-500,
      .error-badge.badge-refused {
        background: rgba(244, 63, 94, 0.2);
        color: #fda4af;
        border: 1px solid rgba(244, 63, 94, 0.35);
      }

      .error-badge.badge-404 {
        background: rgba(245, 158, 11, 0.2);
        color: #fcd34d;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }

      @media (prefers-color-scheme: light) {
        .error-badge.badge-500,
        .error-badge.badge-refused {
          background: rgba(244, 63, 94, 0.12);
          color: #e11d48;
          border-color: rgba(244, 63, 94, 0.25);
        }
        .error-badge.badge-404 {
          background: rgba(245, 158, 11, 0.12);
          color: #b45309;
          border-color: rgba(245, 158, 11, 0.25);
        }
      }

      /* Body Section */
      .body {
        padding: 14px 16px;
      }

      .suggestion-content {
        font-size: 13px;
        line-height: 1.55;
        color: #f1f5f9;
        word-break: break-word;
      }

      @media (prefers-color-scheme: light) {
        .suggestion-content {
          color: #1e293b;
        }
      }

      /* Loading Shimmer State */
      .loading-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .loading-headline {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: #94a3b8;
        font-weight: 500;
      }

      @media (prefers-color-scheme: light) {
        .loading-headline {
          color: #64748b;
        }
      }

      .shimmer-lines {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }

      .shimmer-line {
        height: 10px;
        border-radius: 6px;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.05) 0%,
          rgba(255, 255, 255, 0.18) 50%,
          rgba(255, 255, 255, 0.05) 100%
        );
        background-size: 200% 100%;
        animation: shimmer 1.8s infinite;
      }

      @media (prefers-color-scheme: light) {
        .shimmer-line {
          background: linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.05) 0%,
            rgba(0, 0, 0, 0.12) 50%,
            rgba(0, 0, 0, 0.05) 100%
          );
          background-size: 200% 100%;
        }
      }

      .shimmer-line.line-1 { width: 100%; }
      .shimmer-line.line-2 { width: 88%; }
      .shimmer-line.line-3 { width: 65%; }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* Footer */
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px 12px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 11px;
      }

      @media (prefers-color-scheme: light) {
        .footer {
          border-top-color: rgba(15, 23, 42, 0.08);
        }
      }

      .engine-badge {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #94a3b8;
        font-weight: 500;
      }

      @media (prefers-color-scheme: light) {
        .engine-badge {
          color: #64748b;
        }
      }

      .copy-button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: rgba(99, 102, 241, 0.18);
        color: #a5b4fc;
        border: 1px solid rgba(99, 102, 241, 0.35);
        border-radius: 8px;
        padding: 4px 10px;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .copy-button:hover {
        background: rgba(99, 102, 241, 0.28);
        color: #ffffff;
        border-color: rgba(99, 102, 241, 0.5);
      }

      .copy-button.copied {
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
        border-color: rgba(16, 185, 129, 0.4);
      }

      @media (prefers-color-scheme: light) {
        .copy-button {
          background: rgba(99, 102, 241, 0.1);
          color: #4f46e5;
          border-color: rgba(99, 102, 241, 0.25);
        }
        .copy-button:hover {
          background: rgba(99, 102, 241, 0.18);
          color: #3730a3;
        }
        .copy-button.copied {
          background: rgba(16, 185, 129, 0.12);
          color: #059669;
          border-color: rgba(16, 185, 129, 0.3);
        }
      }
    `;
  }

  /**
   * Closes and removes the current overlay with animation
   */
  function dismissOverlay() {
    clearTimeout(dismissTimer);
    dismissTimer = null;

    if (!shadowRoot) return;
    const wrapper = shadowRoot.querySelector('.overlay-wrapper');
    if (wrapper) {
      wrapper.classList.add('fade-out');
      setTimeout(() => {
        if (currentHost && currentHost.parentNode) {
          currentHost.parentNode.removeChild(currentHost);
        }
        currentHost = null;
        shadowRoot = null;
      }, 240);
    }
  }

  /**
   * Starts or resumes the 20-second auto-dismiss countdown
   */
  function startDismissTimer() {
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismissOverlay();
    }, AUTO_DISMISS_MS);
  }

  /**
   * Pauses the auto-dismiss countdown (e.g. when hovered)
   */
  function pauseDismissTimer() {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  /**
   * Determines styling classes for the error badge
   */
  function getBadgeClass(statusStr) {
    const s = String(statusStr || '');
    if (s.includes('404')) return 'badge-404';
    if (s.includes('500')) return 'badge-500';
    return 'badge-refused';
  }

  /**
   * Formats a clean error badge label
   */
  function formatBadgeLabel(statusStr) {
    const s = String(statusStr || '');
    if (s.includes('net::ERR_CONNECTION_REFUSED')) return 'ERR_CONNECTION_REFUSED';
    if (s.startsWith('net::')) return s.replace(/^net::/, '');
    return s;
  }

  /**
   * Renders or updates the overlay in the loading state
   */
  function renderLoading(payload) {
    const root = getOrCreateShadowRoot();
    currentSuggestionText = '';

    const method = escapeHtml(payload.method || 'GET');
    const displayUrl = escapeHtml(formatDisplayUrl(payload.url));
    const fullUrl = escapeHtml(payload.url || '');
    const badgeLabel = escapeHtml(formatBadgeLabel(payload.error || payload.status));
    const badgeClass = getBadgeClass(payload.error || payload.status);

    root.innerHTML = `
      <style>${getInlineStyles()}</style>
      <div class="overlay-wrapper" id="overlay-card">
        <div class="header">
          <div class="brand">
            <span class="status-dot loading"></span>
            <span class="title">AI Debugger</span>
          </div>
          <button class="close-button" id="btn-close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="request-bar">
          <span class="method">${method}</span>
          <span class="url-snippet" title="${fullUrl}">${displayUrl}</span>
          <span class="error-badge ${badgeClass}">${badgeLabel}</span>
        </div>

        <div class="body">
          <div class="loading-container">
            <div class="loading-headline">
              <span>Analyzing error with local AI...</span>
            </div>
            <div class="shimmer-lines">
              <div class="shimmer-line line-1"></div>
              <div class="shimmer-line line-2"></div>
              <div class="shimmer-line line-3"></div>
            </div>
          </div>
        </div>

        <div class="footer">
          <div class="engine-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
              <rect x="9" y="9" width="6" height="6"></rect>
              <line x1="9" y1="1" x2="9" y2="4"></line>
              <line x1="15" y1="1" x2="15" y2="4"></line>
              <line x1="9" y1="20" x2="9" y2="23"></line>
              <line x1="15" y1="20" x2="15" y2="23"></line>
            </svg>
            <span>Ollama • llama3.2</span>
          </div>
        </div>
      </div>
    `;

    attachOverlayInteractions(root);
  }

  /**
   * Renders or updates the overlay in the completed AI diagnosis state
   */
  function renderResult(payload) {
    const root = getOrCreateShadowRoot();
    currentSuggestionText = payload.suggestion || '';

    const method = escapeHtml(payload.method || 'GET');
    const displayUrl = escapeHtml(formatDisplayUrl(payload.url));
    const fullUrl = escapeHtml(payload.url || '');
    const badgeLabel = escapeHtml(formatBadgeLabel(payload.error || payload.status));
    const badgeClass = getBadgeClass(payload.error || payload.status);
    const suggestionHtml = escapeHtml(currentSuggestionText);

    root.innerHTML = `
      <style>${getInlineStyles()}</style>
      <div class="overlay-wrapper" id="overlay-card">
        <div class="header">
          <div class="brand">
            <span class="status-dot"></span>
            <span class="title">AI Debugger</span>
          </div>
          <button class="close-button" id="btn-close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="request-bar">
          <span class="method">${method}</span>
          <span class="url-snippet" title="${fullUrl}">${displayUrl}</span>
          <span class="error-badge ${badgeClass}">${badgeLabel}</span>
        </div>

        <div class="body">
          <div class="suggestion-content">
            ${suggestionHtml}
          </div>
        </div>

        <div class="footer">
          <div class="engine-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
              <rect x="9" y="9" width="6" height="6"></rect>
              <line x1="9" y1="1" x2="9" y2="4"></line>
              <line x1="15" y1="1" x2="15" y2="4"></line>
              <line x1="9" y1="20" x2="9" y2="23"></line>
              <line x1="15" y1="20" x2="15" y2="23"></line>
            </svg>
            <span>Ollama • llama3.2</span>
          </div>
          <button class="copy-button" id="btn-copy">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span id="copy-text">Copy</span>
          </button>
        </div>
      </div>
    `;

    attachOverlayInteractions(root);
    startDismissTimer();
  }

  /**
   * Attaches event handlers for Close button, Copy button, and Hover auto-dismiss pausing
   */
  function attachOverlayInteractions(root) {
    const card = root.getElementById('overlay-card');
    const closeBtn = root.getElementById('btn-close');
    const copyBtn = root.getElementById('btn-copy');

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissOverlay();
      });
    }

    // Copy button
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentSuggestionText) return;

        try {
          await navigator.clipboard.writeText(currentSuggestionText);
          const copyTextSpan = root.getElementById('copy-text');
          copyBtn.classList.add('copied');
          if (copyTextSpan) copyTextSpan.textContent = 'Copied!';

          setTimeout(() => {
            copyBtn.classList.remove('copied');
            if (copyTextSpan) copyTextSpan.textContent = 'Copy';
          }, 2000);
        } catch (copyErr) {
          console.warn('[AI Debugger] Clipboard write failed:', copyErr);
        }
      });
    }

    // Hover detection: pause auto-dismiss timer on hover, resume on mouse leave
    if (card) {
      card.addEventListener('mouseenter', () => {
        pauseDismissTimer();
      });

      card.addEventListener('mouseleave', () => {
        startDismissTimer();
      });
    }
  }

  /**
   * Runtime message listener from background service worker
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'AI_DEBUG_LOADING') {
      renderLoading(message.payload);
      sendResponse({ status: 'received_loading' });
      return true;
    }

    if (message.type === 'AI_DEBUG_RESULT') {
      renderResult(message.payload);
      sendResponse({ status: 'received_result' });
      return true;
    }
  });
})();
