const tableBody = document.getElementById('submissionsTableBody');
const pinInput = document.getElementById('pinInput');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnLogout = document.getElementById('btnLogout');
const toastNotification = document.getElementById('toastNotification');

const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statApproved = document.getElementById('statApproved');
const statCompleted = document.getElementById('statCompleted');

let submissions = [];
let audioContext = null;
let lastSeenSubmissionId = 0;
let pollTimer = null;

// Minimal notification sound
function playNotificationSound() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioContext.currentTime);
    osc.frequency.setValueAtTime(880, audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.35);
  } catch (e) {
    console.error(e);
  }
}

function showToast(message) {
  toastNotification.textContent = message;
  toastNotification.classList.remove('hidden');
  setTimeout(() => {
    toastNotification.classList.add('hidden');
  }, 3500);
}

// Check auth & load data
async function checkAuth() {
  try {
    const res = await fetch('/api/admin/me');
    if (!res.ok) {
      window.location.href = '/admin/login';
      return false;
    }
    return true;
  } catch (err) {
    window.location.href = '/admin/login';
    return false;
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings');
    if (res.ok) {
      const data = await res.json();
      pinInput.value = data.global_pin || '12';
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadSubmissions(silent = false) {
  try {
    const res = await fetch('/api/admin/submissions');
    if (res.ok) {
      const newSubmissions = await res.json();
      
      // Detect newly arrived submissions across any admin instance
      if (submissions.length > 0 && newSubmissions.length > 0) {
        const newestOldId = Math.max(...submissions.map(s => Number(s.id)));
        const freshlyAdded = newSubmissions.filter(s => Number(s.id) > newestOldId);
        
        if (freshlyAdded.length > 0 && !silent) {
          playNotificationSound();
          showToast(`New submission: ${freshlyAdded[0].username}`);
        }
      }

      submissions = newSubmissions;
      renderTable();
      updateStats();
    }
  } catch (e) {
    console.error(e);
  }
}

function updateStats() {
  statTotal.textContent = submissions.length;
  statPending.textContent = submissions.filter(s => s.status === 'pending').length;
  statApproved.textContent = submissions.filter(s => s.status === 'approved').length;
  statCompleted.textContent = submissions.filter(s => s.status === 'completed').length;
}

function renderTable() {
  tableBody.innerHTML = '';

  if (submissions.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #747775; padding: 32px;">No submissions yet</td></tr>';
    return;
  }

  submissions.forEach(sub => {
    const tr = document.createElement('tr');
    tr.id = `row-${sub.id}`;

    let statusBadge = `<span class="badge badge-${sub.status}">${sub.status}</span>`;
    let actionCell = '-';

    if (sub.status === 'pending') {
      actionCell = `
        <div class="action-box">
          <button type="button" class="btn-sm btn-approve" onclick="handleApprove(${sub.id})">Approve</button>
          <button type="button" class="btn-sm btn-reject" onclick="handleReject(${sub.id})">Reject</button>
        </div>
      `;
    }

    tr.innerHTML = `
      <td>${sub.id}</td>
      <td><strong>${escapeHtml(sub.username)}</strong></td>
      <td><code>${escapeHtml(sub.submitted_coupon)}</code></td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">${actionCell}</td>
    `;

    tableBody.appendChild(tr);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Copy to clipboard helper
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
}

// Global actions for inline buttons
window.handleApprove = async function(id) {
  const currentPin = pinInput.value.trim() || '1234';

  try {
    const res = await fetch(`/api/admin/submissions/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentPin })
    });

    if (res.ok) {
      const sub = submissions.find(s => s.id === id);
      if (sub) {
        sub.status = 'approved';
        sub.reward_pin = currentPin;
        renderTable();
        updateStats();

        // Automatic copy to clipboard: Username and Submitted Coupon
        const textToCopy = `User: ${sub.username}\nCoupon: ${sub.submitted_coupon}`;
        await copyToClipboard(textToCopy);
        showToast('Copied user & coupon to clipboard');
      }
      // Trigger background sync across all admins
      loadSubmissions(true);
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to approve');
    }
  } catch (err) {
    console.error(err);
  }
};

window.handleReject = async function(id) {
  if (!confirm('Reject this submission?')) return;

  try {
    const res = await fetch(`/api/admin/submissions/${id}/reject`, {
      method: 'POST'
    });

    if (res.ok) {
      const sub = submissions.find(s => s.id === id);
      if (sub) {
        sub.status = 'rejected';
        renderTable();
        updateStats();
      }
      loadSubmissions(true);
    }
  } catch (err) {
    console.error(err);
  }
};

// Save PIN Setting
btnSaveSettings.addEventListener('click', async () => {
  const pin = pinInput.value.trim();

  if (pin && (pin.length < 2 || pin.length > 4)) {
    alert('PIN must be 2 to 4 digits');
    return;
  }

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global_pin: pin })
    });

    if (res.ok) {
      showToast('PIN saved');
      await loadSettings();
    }
  } catch (err) {
    console.error(err);
  }
});

// Logout
btnLogout.addEventListener('click', async () => {
  if (pollTimer) clearInterval(pollTimer);
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// Multi-admin real-time sync: SSE + 2-second background polling
function setupAdminRealtime() {
  // Polling every 2s ensures that even across different Vercel serverless containers,
  // multiple admins are always 100% in sync without missing a single submission or decision
  pollTimer = setInterval(() => {
    loadSubmissions(false);
  }, 2000);

  try {
    const sse = new EventSource('/api/admin/events');

    sse.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_submission') {
          await loadSubmissions(false);
        } else if (data.type === 'submission_approved' || data.type === 'submission_rejected' || data.type === 'status_updated') {
          await loadSubmissions(true);
        }
      } catch (e) {
        console.error(e);
      }
    };

    sse.onerror = () => {
      // Reconnection handled automatically by browser; pollTimer keeps sync alive
    };
  } catch (e) {
    console.error(e);
  }
}

// Init
(async () => {
  const isAuthed = await checkAuth();
  if (isAuthed) {
    await loadSettings();
    await loadSubmissions(true);
    setupAdminRealtime();
  }
})();
