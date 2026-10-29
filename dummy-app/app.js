/**
 * AI Error Debugger - Dummy Test Web App Logic
 *
 * Implements the 3 trigger buttons:
 * 1. Trigger Payment API -> fetch('http://localhost:9999/api/pay') (ERR_CONNECTION_REFUSED)
 * 2. Trigger 404         -> fetch('http://localhost:3000/api/missing') (404 Not Found)
 * 3. Trigger 500         -> fetch('http://localhost:3000/api/crash') (500 Internal Server Error)
 *
 * Logs failures to console and displays a "Request failed" status line on the page.
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnPay = document.getElementById('btn-pay');
  const btn404 = document.getElementById('btn-404');
  const btn500 = document.getElementById('btn-500');
  const statusLine = document.getElementById('status-line');
  const statusDot = document.getElementById('status-indicator-dot');

  /**
   * Updates the on-screen status line without swallowing the error
   */
  function setStatus(message, type = 'error') {
    const timestamp = new Date().toLocaleTimeString();
    if (statusLine) {
      statusLine.textContent = `[${timestamp}] ${message}`;
      statusLine.className = `status-line-box status-${type}`;
    }
    if (statusDot) {
      statusDot.className = `status-indicator-dot dot-${type}`;
    }
  }

  /**
   * Button 1: Trigger Payment API
   * Calls port 9999 where nothing is running -> net::ERR_CONNECTION_REFUSED
   */
  btnPay.addEventListener('click', async () => {
    const url = 'http://localhost:9999/api/pay';
    setStatus(`Initiating request to ${url}...`, 'pending');

    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        console.error(`[Payment API] HTTP ${response.status} ${response.statusText} from ${url}`);
        setStatus(`Request failed: HTTP ${response.status} ${response.statusText} (${url})`, 'error');
      } else {
        setStatus(`Request succeeded: ${response.status} (${url})`, 'success');
      }
    } catch (err) {
      console.error('[Payment API Network Failure]', err);
      // The browser throws TypeError: Failed to fetch on connection refused
      setStatus(`Request failed: net::ERR_CONNECTION_REFUSED (${url})`, 'error');
    }
  });

  /**
   * Button 2: Trigger 404 Missing Route
   * Calls /api/missing -> HTTP 404 Not Found
   */
  btn404.addEventListener('click', async () => {
    const url = 'http://localhost:3000/api/missing';
    setStatus(`Initiating request to ${url}...`, 'pending');

    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        console.error(`[404 Route] HTTP ${response.status} ${response.statusText} from ${url}`);
        setStatus(`Request failed: HTTP ${response.status} Not Found (${url})`, 'error');
      } else {
        setStatus(`Request succeeded: ${response.status} (${url})`, 'success');
      }
    } catch (err) {
      console.error('[404 Route Network Failure]', err);
      setStatus(`Request failed: ${err.message} (${url})`, 'error');
    }
  });

  /**
   * Button 3: Trigger 500 Crash Route
   * Calls /api/crash -> HTTP 500 Internal Server Error
   */
  btn500.addEventListener('click', async () => {
    const url = 'http://localhost:3000/api/crash';
    setStatus(`Initiating request to ${url}...`, 'pending');

    try {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        console.error(`[500 Route] HTTP ${response.status} ${response.statusText} from ${url}`);
        setStatus(`Request failed: HTTP ${response.status} Internal Server Error (${url})`, 'error');
      } else {
        setStatus(`Request succeeded: ${response.status} (${url})`, 'success');
      }
    } catch (err) {
      console.error('[500 Route Network Failure]', err);
      setStatus(`Request failed: ${err.message} (${url})`, 'error');
    }
  });
});
