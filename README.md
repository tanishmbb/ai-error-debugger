# AI Error Debugger

An agentic Manifest V3 Chrome Extension that catches failed network requests in real-time, diagnoses their root causes using a **local Ollama LLM** (`llama3.2`), and renders actionable solutions via a glassmorphism overlay inside the page where the error occurred.

Zero cloud APIs, zero API keys, 100% private and offline-capable.

---

## Architecture Overview

```
┌──────────────────┐            ┌───────────────────────────┐            ┌────────────────────────┐
│  Web Page (Tab)  │            │   Extension Service Worker │            │  Local Ollama Service  │
│                  │            │      (background.js)      │            │     (localhost:11434)  │
└────────┬─────────┘            └─────────────┬─────────────┘            └───────────┬────────────┘
         │                                    │                                      │
         │ 1. Failed request (fetch / XHR)   │                                      │
         ├───────────────────────────────────►│                                      │
         │                                    │ 2. Dedupe & notify                   │
         │                                    │    (desktop notification)            │
         │ 3. Send AI_DEBUG_LOADING           │                                      │
         │◄───────────────────────────────────┤                                      │
         │    (Displays shimmer overlay)      │                                      │
         │                                    │ 4. POST /api/generate                │
         │                                    │    model: llama3.2                   │
         │                                    ├─────────────────────────────────────►│
         │                                    │                                      │
         │                                    │ 5. Returns 2-sentence fix            │
         │                                    │◄─────────────────────────────────────┤
         │ 6. Send AI_DEBUG_RESULT            │                                      │
         │◄───────────────────────────────────┤                                      │
         │    (Displays AI diagnosis overlay) │                                      │
```

---

## Project Structure

```
ai-error-debugger/
├── extension/
│   ├── manifest.json       # Chrome MV3 manifest with permissions & observation listeners
│   ├── background.js       # Service worker: request interception, debouncing & Ollama client
│   └── content.js          # Shadow DOM glassmorphic overlay & real-time messaging
├── dummy-app/
│   ├── server.js           # Zero-dependency Node.js HTTP server (port 3000)
│   ├── index.html          # Test UI with 3 trigger buttons & status monitor
│   ├── app.js              # Network trigger event handlers & error reporting
│   └── styles.css          # Modern dark/light glassmorphism styles
└── README.md
```

---

## Prerequisites

1. **Node.js**: v18.0.0 or higher.
2. **Ollama**: Installed on your operating system ([https://ollama.com](https://ollama.com)).
3. **Llama 3.2 Model**: Downloaded locally via Ollama:
   ```bash
   ollama pull llama3.2
   ```

---

## Configuration: Setting `OLLAMA_ORIGINS`

By default, Ollama restricts incoming HTTP requests from browser extensions (which send the `chrome-extension://<id>` Origin header). You must allow extension origins before starting Ollama.

### Windows
- **PowerShell (Temporary session):**
  ```powershell
  $env:OLLAMA_ORIGINS="chrome-extension://*"
  ollama serve
  ```
- **PowerShell (Permanent for current user):**
  ```powershell
  [System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', 'chrome-extension://*', 'User')
  ```
  *Note: Exit Ollama from the Windows system tray and restart it.*
- **Command Prompt (CMD):**
  ```cmd
  set OLLAMA_ORIGINS=chrome-extension://*
  ollama serve
  ```

### macOS
- **Terminal (Direct process):**
  ```bash
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```
- **If running Ollama.app GUI:**
  ```bash
  launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
  ```
  *Then quit Ollama from the menu bar and reopen it.*

### Linux (systemd)
1. Edit the service configuration:
   ```bash
   sudo systemctl edit ollama.service
   ```
2. Add the following block under `[Service]`:
   ```ini
   [Service]
   Environment="OLLAMA_ORIGINS=chrome-extension://*"
   ```
3. Reload and restart:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

---

## Installation & Setup

### 1. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `extension` folder located at:
   ```
   d:/agentic ai project/ai-error-debugger/extension
   ```
5. Confirm that **AI Error Debugger** appears in your extensions list.

### 2. Start the Dummy Test Web App
1. Open a terminal and navigate to `dummy-app`:
   ```bash
   cd "d:/agentic ai project/ai-error-debugger/dummy-app"
   ```
2. Start the zero-dependency Node.js server:
   ```bash
   node server.js
   ```
3. Open your browser and visit:
   ```
   http://localhost:3000
   ```

---

## Expected Behavior for Each Trigger Button

| Button | Endpoint & Failure Type | Expected Extension Behavior |
| :--- | :--- | :--- |
| **Trigger Payment API** | `POST http://localhost:9999/api/pay`<br>`net::ERR_CONNECTION_REFUSED` | 1. Page status line displays error.<br>2. Desktop notification: *"Caught error on localhost:9999. Analyzing..."*<br>3. Bottom-right overlay renders with **ERR_CONNECTION_REFUSED** badge and loading shimmer.<br>4. Ollama analyzes error and returns a concise 2-sentence fix: *"Server is offline or port 9999 is inactive. Ensure the payment service daemon is started on port 9999."* |
| **Trigger 404** | `GET http://localhost:3000/api/missing`<br>`HTTP 404 Not Found` | 1. Page status updates to 404.<br>2. Notification fires.<br>3. Overlay shows amber **404** badge and loading shimmer.<br>4. Ollama returns 2-sentence diagnosis explaining the route was not found in the routing table and suggests verifying the endpoint path. |
| **Trigger 500** | `POST http://localhost:3000/api/crash`<br>`HTTP 500 Internal Server Error` | 1. Page status updates to 500.<br>2. Notification fires.<br>3. Overlay shows rose **500** badge and loading shimmer.<br>4. Ollama returns 2-sentence diagnosis diagnosing an unhandled server-side exception and recommending checking backend crash logs. |

---

## Overlay Features & Interactions

- **Shadow DOM Isolation**: The overlay is rendered inside an `open` Shadow Root. It is immune to page styles and does not bleed styles into the web application.
- **Auto-Dismiss**: Automatically fades out after 20 seconds.
- **Hover Detection**: Hovering over the overlay card pauses the 20-second dismiss timer. Moving the cursor away resumes the countdown.
- **Copy Button**: Copies the AI diagnosis text directly to your clipboard with immediate visual feedback (`✓ Copied!`).
- **Close Button**: Instantly dismisses the overlay with a smooth exit transition.
- **Deduplication / Debounce**: Rapid repeated errors for the same URL and error within 5 seconds are debounced and processed only once.
- **Infinite Loop Guard**: Requests to `http://localhost:11434` (Ollama's API) are strictly ignored by the service worker to prevent self-triggering loops.

---

## Troubleshooting Guide

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **"Ollama isn't reachable" overlay message** | Ollama is not running or port 11434 is blocked. | Run `ollama serve` in a terminal. Verify `http://localhost:11434/api/tags` returns HTTP 200. |
| **"Ollama blocked the extension origin" (403)** | Missing `OLLAMA_ORIGINS` environment variable. | Set `OLLAMA_ORIGINS="chrome-extension://*"` and restart Ollama as detailed in the Configuration section. |
| **"Model not found" (404)** | The `llama3.2` model has not been pulled. | Run `ollama pull llama3.2` in your terminal and verify with `ollama list`. |
| **"Local model took too long" (Timeout)** | Model generation exceeded the 30-second deadline. | Ensure your CPU/GPU has enough resources available. If running on a slow CPU, warm up the model with `ollama run llama3.2 "hello"`. |
| **Overlay not showing in tab** | Tab was opened prior to loading the extension. | Refresh the page once or click any button. The extension will automatically inject `content.js` dynamically via `chrome.scripting.executeScript`. |
| **No desktop notification appears** | OS or Chrome notification permissions disabled. | Ensure notifications are permitted for Chrome in Windows/macOS Settings, and check that *Do Not Disturb* / *Focus Assist* is not active. |
