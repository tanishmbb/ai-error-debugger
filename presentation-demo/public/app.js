/**
 * TaskFlow Pro - Client-side Application Logic
 *
 * Implements 3 realistic failure scenarios designed for the AI Error Debugger presentation:
 * 1. The 404 Typo on Load: Calls /api/v1/user-profle (spelling typo) -> Triggers AI 404 Diagnosis.
 * 2. The 500 Database Crash: POST /api/v1/tasks -> Triggers AI 500 Database Crash Diagnosis.
 * 3. The ECONNREFUSED Microservice: fetch('http://localhost:5555/generate-pdf') -> Triggers AI Port Refusal Diagnosis.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Bug 1 immediately on page load
  loadUserProfile();

  // Attach Bug 2: Task Save (500 DB Crash)
  initTaskCreation();

  // Attach Bug 3: PDF Export Microservice (ECONNREFUSED)
  initPdfExport();

  // Attach cosmetic UI tab & checkbox interactions
  initUIInteractions();
});

// =====================================================================
// BUG 1: The 404 Typo (Fails on Load)
// Immediately fetches user profile data with an intentional route typo
// =====================================================================
async function loadUserProfile() {
  const profileNameEl = document.getElementById('user-name-display');
  const profileSpinnerEl = document.getElementById('profile-spinner');

  console.log('[TaskFlow Pro] Initializing workspace session: fetching active user profile...');

  try {
    // REALISTIC BUG: Notice the typo in the endpoint: 'user-profle' instead of 'user-profile'
    const response = await fetch('/api/v1/user-profle');

    if (!response.ok) {
      // The server returns HTTP 404 Not Found
      console.error(
        `[TaskFlow Profile Error] HTTP ${response.status} ${response.statusText} for URL: /api/v1/user-profle\n` +
        `The endpoint /api/v1/user-profle was not found on the backend routing table.`
      );
      // The UI leaves the subtle spinner running, creating a silent visual glitch
      // that the AI Error Debugger Chrome Extension immediately diagnoses!
      if (profileNameEl) {
        profileNameEl.textContent = 'Loading profile...';
      }
      return;
    }

    const userData = await response.json();
    if (profileNameEl) profileNameEl.textContent = userData.name || 'Alex Rivera';
    if (profileSpinnerEl) profileSpinnerEl.style.display = 'none';
  } catch (networkErr) {
    console.error('[TaskFlow Profile Error] Network request failure:', networkErr);
  }
}

// =====================================================================
// BUG 2: The 500 Database Crash (Fails on Action)
// Sends a valid payload, but backend catches and returns HTTP 500
// =====================================================================
function initTaskCreation() {
  const saveBtn = document.getElementById('btn-save-task');
  const saveLabel = document.getElementById('save-task-label');
  const taskInput = document.getElementById('new-task-title');
  const prioritySelect = document.getElementById('new-task-priority');
  const tagSelect = document.getElementById('new-task-tag');
  const statusHint = document.getElementById('task-action-status');

  if (!saveBtn) return;

  saveBtn.addEventListener('click', async () => {
    const title = taskInput ? taskInput.value.trim() : '';
    const priority = prioritySelect ? prioritySelect.value : 'High';
    const tag = tagSelect ? tagSelect.value : 'Backend';

    if (!title) {
      if (statusHint) {
        statusHint.textContent = 'Please enter a task title.';
        statusHint.className = 'action-status-line status-warning';
      }
      return;
    }

    // Set UI to loading state
    saveBtn.disabled = true;
    if (saveLabel) saveLabel.textContent = 'Saving to Database...';
    if (statusHint) {
      statusHint.textContent = 'Connecting to database cluster...';
      statusHint.className = 'action-status-line status-info';
    }

    console.log('[TaskFlow Task Action] Dispatching POST /api/v1/tasks entity:', { title, priority, tag });

    try {
      const response = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Source': 'TaskFlow-Web-v4.2'
        },
        body: JSON.stringify({
          title: title,
          priority: priority,
          tag: tag,
          sprintId: 'sprint_42',
          createdAt: new Date().toISOString()
        })
      });

      if (!response.ok) {
        // Backend returned 500 Internal Server Error
        console.error(
          `[TaskFlow Backend Crash] HTTP ${response.status} ${response.statusText}\n` +
          `Failed to persist task entity to PostgreSQL primary node. Transaction timed out.`
        );

        // Revert UI button state, but the task is NOT added to the list
        if (statusHint) {
          statusHint.textContent = 'Failed to persist task: Database timeout (HTTP 500)';
          statusHint.className = 'action-status-line status-error';
        }
      } else {
        const result = await response.json();
        console.log('[TaskFlow Task Action] Task persisted:', result);
      }
    } catch (err) {
      console.error('[TaskFlow Task Action] Request failed:', err);
    } finally {
      // Revert button so user can retry or observe AI overlay diagnosis
      saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = 'Save Task';
    }
  });
}

// =====================================================================
// BUG 3: The ECONNREFUSED Microservice (Fails on Export)
// Calls an external export microservice on port 5555 where nothing listens
// =====================================================================
function initPdfExport() {
  const exportBtn = document.getElementById('btn-export-pdf');
  const exportLabel = document.getElementById('export-btn-label');

  if (!exportBtn) return;

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    if (exportLabel) exportLabel.textContent = 'Connecting to port 5555...';

    const microserviceUrl = 'http://localhost:5555/generate-pdf';
    console.log(`[TaskFlow Microservice] Attempting handshake with PDF Export Worker at ${microserviceUrl}...`);

    try {
      // Port 5555 is offline -> Native browser net::ERR_CONNECTION_REFUSED
      const response = await fetch(microserviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'acme_hq',
          sprint: 'Sprint 42',
          format: 'pdf_vector'
        })
      });

      console.log('[TaskFlow Microservice] Export response received:', response.status);
    } catch (netErr) {
      // Browser throws TypeError: Failed to fetch (net::ERR_CONNECTION_REFUSED)
      console.error(
        `[TaskFlow Microservice Connection Failure] Handshake failed at ${microserviceUrl}\n` +
        `The external PDF rendering daemon is not running on port 5555 (ERR_CONNECTION_REFUSED).`
      );
    } finally {
      setTimeout(() => {
        exportBtn.disabled = false;
        if (exportLabel) exportLabel.textContent = 'Export to PDF';
      }, 1000);
    }
  });
}

// =====================================================================
// General UI Tab & Checkbox Micro-interactions
// =====================================================================
function initUIInteractions() {
  // Filter tabs
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Task item checkboxes
  const taskRows = document.querySelectorAll('.task-row');
  taskRows.forEach(row => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const title = row.querySelector('.task-title');
    if (checkbox && title) {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          title.classList.add('strike');
        } else {
          title.classList.remove('strike');
        }
      });
    }
  });
}
