const domTableBody = document.getElementById('submissionsTableBody');
const domInputPin = document.getElementById('pinInput');
const domBtnSaveSettings = document.getElementById('btnSaveSettings');
const domBtnLogout = document.getElementById('btnLogout');
const domNotificationToast = document.getElementById('toastNotification');

const domStatTotal = document.getElementById('statTotal');
const domStatPending = document.getElementById('statPending');
const domStatApproved = document.getElementById('statApproved');
const domStatCompleted = document.getElementById('statCompleted');

let cachedSubmissionsList = [];
let audioChimeContext = null;
let liveSyncIntervalTimer = null;

function triggerAudioAlert() {
  try {
    if (!audioChimeContext) {
      audioChimeContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioChimeContext.state === 'suspended') {
      audioChimeContext.resume();
    }
    const oscillatorNode = audioChimeContext.createOscillator();
    const gainNode = audioChimeContext.createGain();
    oscillatorNode.type = 'sine';
    oscillatorNode.frequency.setValueAtTime(587.33, audioChimeContext.currentTime);
    oscillatorNode.frequency.setValueAtTime(880, audioChimeContext.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.15, audioChimeContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioChimeContext.currentTime + 0.35);
    oscillatorNode.connect(gainNode);
    gainNode.connect(audioChimeContext.destination);
    oscillatorNode.start();
    oscillatorNode.stop(audioChimeContext.currentTime + 0.35);
  } catch (audioErr) {
    console.error('Audio alert error:', audioErr);
  }
}

function displayBannerNotification(notificationText) {
  domNotificationToast.textContent = notificationText;
  domNotificationToast.classList.remove('hidden');
  setTimeout(() => {
    domNotificationToast.classList.add('hidden');
  }, 3500);
}

async function verifyAdminAuthentication() {
  try {
    const authCheckResponse = await fetch('/api/admin/me');
    if (!authCheckResponse.ok) {
      window.location.href = '/admin/login';
      return false;
    }
    return true;
  } catch (authErr) {
    window.location.href = '/admin/login';
    return false;
  }
}

async function fetchSavedSettings() {
  try {
    const settingsResponse = await fetch('/api/admin/settings');
    if (settingsResponse.ok) {
      const settingsPayload = await settingsResponse.json();
      domInputPin.value = settingsPayload.global_pin || '12';
    }
  } catch (settingsErr) {
    console.error('Settings fetch error:', settingsErr);
  }
}

async function refreshSubmissionRecords(suppressAlert = false) {
  try {
    const fetchResponse = await fetch('/api/admin/submissions');
    if (fetchResponse.ok) {
      const latestEntries = await fetchResponse.json();

      if (cachedSubmissionsList.length > 0 && latestEntries.length > 0) {
        const previousHighestId = Math.max(...cachedSubmissionsList.map(entry => Number(entry.id)));
        const newlyReceivedEntries = latestEntries.filter(entry => Number(entry.id) > previousHighestId);

        if (newlyReceivedEntries.length > 0 && !suppressAlert) {
          triggerAudioAlert();
          displayBannerNotification(`New submission: ${newlyReceivedEntries[0].username}`);
        }
      }

      cachedSubmissionsList = latestEntries;
      renderSubmissionsTable();
      refreshMetricsDisplay();
    }
  } catch (refreshErr) {
    console.error('Refresh error:', refreshErr);
  }
}

function refreshMetricsDisplay() {
  domStatTotal.textContent = cachedSubmissionsList.length;
  domStatPending.textContent = cachedSubmissionsList.filter(item => item.status === 'pending').length;
  domStatApproved.textContent = cachedSubmissionsList.filter(item => item.status === 'approved').length;
  domStatCompleted.textContent = cachedSubmissionsList.filter(item => item.status === 'completed').length;
}

function renderSubmissionsTable() {
  domTableBody.innerHTML = '';

  if (cachedSubmissionsList.length === 0) {
    domTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #747775; padding: 32px;">No submissions yet</td></tr>';
    return;
  }

  cachedSubmissionsList.forEach(submissionRecord => {
    const rowElement = document.createElement('tr');
    rowElement.id = `row-${submissionRecord.id}`;

    let statusMarkup = `<span class="badge badge-${submissionRecord.status}">${submissionRecord.status}</span>`;
    let actionMarkup = '-';

    if (submissionRecord.status === 'pending') {
      actionMarkup = `
        <div class="action-box">
          <button type="button" class="btn-sm btn-approve" onclick="executeApproveAction(${submissionRecord.id})">Approve</button>
          <button type="button" class="btn-sm btn-reject" onclick="executeRejectAction(${submissionRecord.id})">Reject</button>
        </div>
      `;
    }

    rowElement.innerHTML = `
      <td>${submissionRecord.id}</td>
      <td><strong>${sanitizeHtmlString(submissionRecord.username)}</strong></td>
      <td><code>${sanitizeHtmlString(submissionRecord.submitted_coupon)}</code></td>
      <td>${statusMarkup}</td>
      <td style="text-align: right;">${actionMarkup}</td>
    `;

    domTableBody.appendChild(rowElement);
  });
}

function sanitizeHtmlString(unsafeString) {
  if (!unsafeString) return '';
  return String(unsafeString).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function copyTextToClipboard(textData) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(textData);
    } else {
      const temporaryTextArea = document.createElement('textarea');
      temporaryTextArea.value = textData;
      temporaryTextArea.style.position = 'fixed';
      temporaryTextArea.style.left = '-999999px';
      document.body.appendChild(temporaryTextArea);
      temporaryTextArea.focus();
      temporaryTextArea.select();
      document.execCommand('copy');
      temporaryTextArea.remove();
    }
  } catch (copyErr) {
    console.error('Clipboard copy error:', copyErr);
  }
}

// Approve handler
window.executeApproveAction = async function(recordId) {
  const chosenPin = domInputPin.value.trim() || '12';

  try {
    const approveResponse = await fetch(`/api/admin/submissions/${recordId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: chosenPin })
    });

    if (approveResponse.ok) {
      const targetRecord = cachedSubmissionsList.find(item => item.id === recordId);
      if (targetRecord) {
        targetRecord.status = 'approved';
        targetRecord.reward_pin = chosenPin;
        renderSubmissionsTable();
        refreshMetricsDisplay();

        const formattedClipboardText = `User: ${targetRecord.username}\nCoupon: ${targetRecord.submitted_coupon}`;
        await copyTextToClipboard(formattedClipboardText);
        displayBannerNotification('Copied user & coupon to clipboard');
      }
      refreshSubmissionRecords(true);
    } else {
      const errorData = await approveResponse.json();
      alert(errorData.error || 'Failed to approve');
    }
  } catch (actionErr) {
    console.error('Approve action error:', actionErr);
  }
};

// Reject handler
window.executeRejectAction = async function(recordId) {
  if (!confirm('Reject this submission?')) return;

  try {
    const rejectResponse = await fetch(`/api/admin/submissions/${recordId}/reject`, {
      method: 'POST'
    });

    if (rejectResponse.ok) {
      const targetRecord = cachedSubmissionsList.find(item => item.id === recordId);
      if (targetRecord) {
        targetRecord.status = 'rejected';
        renderSubmissionsTable();
        refreshMetricsDisplay();
      }
      refreshSubmissionRecords(true);
    }
  } catch (actionErr) {
    console.error('Reject action error:', actionErr);
  }
};

// Save PIN
domBtnSaveSettings.addEventListener('click', async () => {
  const enteredPin = domInputPin.value.trim();

  if (enteredPin && (enteredPin.length < 2 || enteredPin.length > 4)) {
    alert('PIN must be 2 to 4 digits');
    return;
  }

  try {
    const saveResponse = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global_pin: enteredPin })
    });

    if (saveResponse.ok) {
      displayBannerNotification('PIN saved');
      await fetchSavedSettings();
    }
  } catch (saveErr) {
    console.error('Settings save error:', saveErr);
  }
});

// Logout
domBtnLogout.addEventListener('click', async () => {
  if (liveSyncIntervalTimer) clearInterval(liveSyncIntervalTimer);
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// Background sync & SSE for all active admins
function startAdminSynchronization() {
  liveSyncIntervalTimer = setInterval(() => {
    refreshSubmissionRecords(false);
  }, 2000);

  try {
    const sseEventSubscriber = new EventSource('/api/admin/events');

    sseEventSubscriber.onmessage = async (incomingMsg) => {
      try {
        const eventData = JSON.parse(incomingMsg.data);
        if (eventData.type === 'new_submission') {
          await refreshSubmissionRecords(false);
        } else if (
          eventData.type === 'submission_approved' ||
          eventData.type === 'submission_rejected' ||
          eventData.type === 'status_updated'
        ) {
          await refreshSubmissionRecords(true);
        }
      } catch (parseErr) {
        console.error('SSE message parsing error:', parseErr);
      }
    };

    sseEventSubscriber.onerror = () => {
      // Automatic browser reconnection; interval timer keeps state synchronized
    };
  } catch (sseInitErr) {
    console.error('SSE initialization error:', sseInitErr);
  }
}

// Entrypoint
(async () => {
  const isAuthorized = await verifyAdminAuthentication();
  if (isAuthorized) {
    await fetchSavedSettings();
    await refreshSubmissionRecords(true);
    startAdminSynchronization();
  }
})();
