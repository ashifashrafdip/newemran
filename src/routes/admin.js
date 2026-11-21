const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sse = require('../sse');

const router = express.Router();

const adminSessions = new Set();

function authMiddleware(req, res, next) {
  const token = req.cookies.admin_session;
  if (!token || !adminSessions.has(token)) {
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
    const sessionToken = crypto.randomBytes(24).toString('hex');
    adminSessions.add(sessionToken);

    res.cookie('admin_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ authenticated: true });
});

router.post('/logout', (req, res) => {
  const token = req.cookies.admin_session;
  if (token) {
    adminSessions.delete(token);
    res.clearCookie('admin_session');
  }
  res.json({ success: true });
});

// Get all submissions
router.get('/submissions', authMiddleware, (req, res) => {
  const submissions = db.getAllSubmissions();
  res.json(submissions);
});

// Approve submission
router.post('/submissions/:id/approve', authMiddleware, (req, res) => {
  const id = req.params.id;
  const submission = db.getSubmissionById(id);
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  let pin = req.body.pin || db.getSetting('global_pin') || '1234';
  pin = String(pin).trim();

  db.approveSubmission(id, pin);

  const redirectUrl = db.getRedirectUrl();

  sse.notifyUser(submission.user_token, {
    status: 'approved',
    reward_pin: pin,
    redirect_url: redirectUrl
  });

  sse.notifyAdmins({
    type: 'submission_approved',
    id: Number(id),
    pin: pin,
    token: submission.user_token
  });

  res.json({ success: true, pin, username: submission.username, coupon: submission.submitted_coupon });
});

// Reject submission
router.post('/submissions/:id/reject', authMiddleware, (req, res) => {
  const id = req.params.id;
  const submission = db.getSubmissionById(id);
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  db.rejectSubmission(id);

  sse.notifyUser(submission.user_token, {
    status: 'rejected'
  });

  sse.notifyAdmins({
    type: 'submission_rejected',
    id: Number(id),
    token: submission.user_token
  });

  res.json({ success: true });
});

// Get & Update PIN Settings only
router.get('/settings', authMiddleware, (req, res) => {
  res.json({
    global_pin: db.getSetting('global_pin')
  });
});

router.post('/settings', authMiddleware, (req, res) => {
  const { global_pin } = req.body;

  if (global_pin !== undefined) {
    db.setSetting('global_pin', String(global_pin).trim());
  }

  res.json({
    success: true,
    global_pin: db.getSetting('global_pin')
  });
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
