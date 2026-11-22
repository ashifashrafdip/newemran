const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sse = require('../sse');

const router = express.Router();

// Secret key for HMAC token signing (persists across serverless container cold starts)
const AUTH_SECRET = process.env.SESSION_SECRET || 'dis-portal-secure-hmac-token-secret-2026';

function generateAdminToken() {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days validity
  const payload = `admin:${expiresAt}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

function verifyAdminToken(token) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [user, expiresAtStr, signature] = decoded.split(':');
    if (user !== 'admin') return false;

    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || Date.now() > expiresAt) return false; // expired

    const expectedPayload = `${user}:${expiresAtStr}`;
    const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(expectedPayload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (e) {
    return false;
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies.admin_session;
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Admin login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === adminUser && password === adminPass) {
    const sessionToken = generateAdminToken();

    res.cookie('admin_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ authenticated: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ success: true });
});

// Get all submissions
router.get('/submissions', authMiddleware, async (req, res) => {
  try {
    const submissions = await db.getAllSubmissions();
    res.json(submissions);
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve submission
router.post('/submissions/:id/approve', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const submission = await db.getSubmissionById(id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const currentGlobalPin = await db.getSetting('global_pin');
    let pin = req.body.pin || currentGlobalPin || '12';
    pin = String(pin).trim();

    await db.approveSubmission(id, pin);

    const redirectUrl = await db.getRedirectUrl();

    // Notify user via SSE
    sse.notifyUser(submission.user_token, {
      status: 'approved',
      reward_pin: pin,
      redirect_url: redirectUrl
    });

    // Notify all admin tabs
    sse.notifyAdmins({
      type: 'submission_approved',
      id: Number(id),
      pin: pin,
      token: submission.user_token
    });

    res.json({ success: true, pin, username: submission.username, coupon: submission.submitted_coupon });
  } catch (err) {
    console.error('Error approving submission:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject submission
router.post('/submissions/:id/reject', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const submission = await db.getSubmissionById(id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    await db.rejectSubmission(id);

    sse.notifyUser(submission.user_token, {
      status: 'rejected'
    });

    sse.notifyAdmins({
      type: 'submission_rejected',
      id: Number(id),
      token: submission.user_token
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error rejecting submission:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get & Update PIN Settings only
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const pin = await db.getSetting('global_pin');
    res.json({
      global_pin: pin || '12'
    });
  } catch (err) {
    console.error('Error getting settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/settings', authMiddleware, async (req, res) => {
  try {
    const { global_pin } = req.body;

    if (global_pin !== undefined) {
      await db.setSetting('global_pin', String(global_pin).trim());
    }

    const updatedPin = await db.getSetting('global_pin');
    res.json({
      success: true,
      global_pin: updatedPin
    });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SSE for admin live updates
router.get('/events', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sse.subscribeAdmin(res);
});

module.exports = router;
