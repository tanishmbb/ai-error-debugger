/**
 * AI Error Debugger - Background Service Worker (Manifest V3)
 *
 * Observes network requests via chrome.webRequest (non-blocking).
 * Detects failures (network-level errors and 4xx/5xx HTTP statuses),
 * notifies the user, requests root-cause diagnostics from a local Ollama LLM,
 * and delivers real-time fixes to the active tab via content script overlays.
 */

// Debug logging flag - set to false in production to prevent console spam
const DEBUG = false;

function log(...args) {
  if (DEBUG) {
    console.log('[AI Debugger]', ...args);
  }
}

function warn(...args) {
  if (DEBUG) {
    console.warn('[AI Debugger]', ...args);
  }
}

// 16x16 purple/indigo PNG icon data URI for desktop notifications
const NOTIFICATION_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNITvv4nxLMMGrAqAGjBgwXAwDvarkfnHQDVQAAAABJRU5ErkJggg==';

// Ollama API configuration
const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'llama3.2';
const OLLAMA_TIMEOUT_MS = 30000;

// Deduplication configuration: window of 5 seconds per url + error
const DEDUPE_WINDOW_MS = 5000;
const recentErrors = new Map(); // key -> timestamp

/**
 * Checks if an error event is a duplicate within the 5-second window.
 * Cleans up expired entries periodically to prevent memory accumulation.
 */
function isDuplicate(tabId, url, errorOrStatus) {
  const now = Date.now();
  const key = `${tabId}|${url}|${errorOrStatus}`;

  // Purge expired keys
  for (const [k, timestamp] of recentErrors.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentErrors.delete(k);
    }
  }

  if (recentErrors.has(key)) {
    const lastSeen = recentErrors.get(key);
    if (now - lastSeen < DEDUPE_WINDOW_MS) {
      log('Debouncing duplicate error event for:', key);
      return true;
    }
  }

  recentErrors.set(key, now);
  return false;
}

/**
 * Validates whether a request should be observed or ignored.
 */
function shouldIgnoreRequest(details) {
  // Ignore non-tab requests (background workers, pre-renders, extensions)
  if (!details || typeof details.tabId !== 'number' || details.tabId === -1) {
    return true;
  }

  const url = details.url || '';

  // Critical: Avoid infinite loops by ignoring the extension's own calls to Ollama
  if (url.startsWith('http://localhost:11434') || url.startsWith('http://127.0.0.1:11434')) {
    return true;
  }

  // Ignore internal browser schemes and extension URLs
  if (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('devtools://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://')
  ) {
    return true;
  }

  return false;
}

/**
 * Safely sends a message to a tab, falling back to dynamic content script injection
 * if the tab was loaded before extension installation/refresh.
 */
async function sendToTabWithFallback(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    log(`Message ${message.type} delivered directly to tab ${tabId}`);
  } catch (initialErr) {
    log(`Initial sendMessage failed for tab ${tabId} (${initialErr.message}). Attempting injection fallback...`);
    try {
      // Inject content.js into the tab
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      // Brief delay to allow content script listeners to initialize
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Retry sending message
      await chrome.tabs.sendMessage(tabId, message);
      log(`Message ${message.type} delivered to tab ${tabId} after injection.`);
    } catch (fallbackErr) {
      warn(`Failed to deliver message ${message.type} to tab ${tabId} after injection:`, fallbackErr.message);
    }
  }
}

/**
 * Dispatches a desktop notification indicating that an error was caught and is being analyzed.
 */
function showDesktopNotification(pageUrl) {
  try {
    let displayPage = 'the active page';
    if (pageUrl && pageUrl !== 'Unknown page') {
      try {
        const parsed = new URL(pageUrl);
        displayPage = parsed.host + (parsed.pathname !== '/' ? parsed.pathname : '');
      } catch {
        displayPage = pageUrl.length > 40 ? pageUrl.slice(0, 37) + '...' : pageUrl;
      }
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_DATA_URL,
      title: 'AI Debugger',
      message: `Caught error on ${displayPage}. Analyzing...`,
      priority: 1
    });
  } catch (notifyErr) {
    warn('Desktop notification creation failed:', notifyErr.message);
  }
}

/**
 * Calls the local Ollama LLM instance with the error context.
 * Returns a 2-sentence diagnostic fix or a graceful user-friendly error message.
 */
async function queryOllamaDiagnosis({ method, url, pageUrl, errorOrStatus }) {
  const prompt = `You are an expert web debugger. The application just threw this error.
Request: ${method} ${url}
Page: ${pageUrl}
Error: ${errorOrStatus}
In exactly 2 short sentences: state the most likely cause, then the most likely fix. No preamble, no markdown.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 150
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle HTTP error responses from Ollama
    if (!response.ok) {
      if (response.status === 403) {
        return 'Ollama blocked the extension origin. Set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.';
      }
      if (response.status === 404) {
        return 'Model not found. Run ollama pull llama3.2.';
      }
      return `Ollama returned HTTP ${response.status}. Please verify your local Ollama instance.`;
    }

    const data = await response.json();
    let rawText = (data && data.response) ? String(data.response) : '';

    // Trim and sanitize response text
    rawText = rawText.trim();
    // Strip accidental enclosing markdown fences or backticks
    rawText = rawText.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

    if (!rawText) {
      return 'No diagnosis generated by local AI. Please verify model output.';
    }

    return rawText;
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle AbortController timeout
    if (err.name === 'AbortError') {
      return 'Local model took too long. Try again.';
    }

    // Handle network / unreachable Ollama daemon
    if (err instanceof TypeError || (err.message && err.message.includes('fetch'))) {
      return "Ollama isn't reachable. Run ollama serve and make sure llama3.2 is pulled.";
    }

    return `Diagnostic request failed: ${err.message || 'Unknown error'}.`;
  }
}

/**
 * Core error processing pipeline:
 * 1. Deduplicates
 * 2. Resolves page context
 * 3. Shows desktop notification
 * 4. Sends loading state to tab
 * 5. Queries Ollama
 * 6. Sends diagnosis result to tab
 */
async function processFailedRequest(details, errorOrStatus) {
  const { tabId, url, method } = details;

  // Deduplication check: 5s per tabId+url+error
  if (isDuplicate(tabId, url, errorOrStatus)) {
    return;
  }

  log(`Processing network failure: ${method} ${url} -> ${errorOrStatus} in tab ${tabId}`);

  // Retrieve current page URL for context
  let pageUrl = 'Unknown page';
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      pageUrl = tab.url;
    }
  } catch (tabErr) {
    log(`Unable to resolve URL for tab ${tabId}:`, tabErr.message);
  }

  // 1. Show desktop notification
  showDesktopNotification(pageUrl);

  // 2. Deliver loading state to tab overlay immediately
  await sendToTabWithFallback(tabId, {
    type: 'AI_DEBUG_LOADING',
    payload: {
      url,
      method,
      error: String(errorOrStatus),
      status: errorOrStatus,
      pageUrl,
      timestamp: Date.now()
    }
  });

  // 3. Query local Ollama for diagnosis
  const suggestion = await queryOllamaDiagnosis({
    method,
    url,
    pageUrl,
    errorOrStatus: String(errorOrStatus)
  });

  // 4. Deliver diagnostic result to tab overlay
  await sendToTabWithFallback(tabId, {
    type: 'AI_DEBUG_RESULT',
    payload: {
      url,
      method,
      error: String(errorOrStatus),
      status: errorOrStatus,
      suggestion,
      pageUrl,
      timestamp: Date.now()
    }
  });
}

/**
 * Top-level WebRequest Listeners (MV3 Requirement: synchronously registered at module root)
 */

// 1. Network-level failures (e.g. net::ERR_CONNECTION_REFUSED, net::ERR_NAME_NOT_RESOLVED)
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (shouldIgnoreRequest(details)) return;

    // Filter out user-cancelled or harmless navigation aborts
    if (details.error === 'net::ERR_ABORTED') {
      return;
    }

    processFailedRequest(details, details.error || 'Network Error');
  },
  {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest']
  }
);

// 2. HTTP response completions (only act on HTTP status >= 400)
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (shouldIgnoreRequest(details)) return;

    if (typeof details.statusCode === 'number' && details.statusCode >= 400) {
      processFailedRequest(details, details.statusCode);
    }
  },
  {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest']
  }
);

log('AI Error Debugger service worker initialized.');
