const express = require('express');
const crypto = require('crypto');
const database = require('../db');
const eventHub = require('../sse');
const config = require('../config');

const adminEndpointRouter = express.Router();

function createAdminAuthToken() {
  const expiryTimestamp = Date.now() + config.SESSION_MAX_AGE_MS;
  const tokenPayload = `admin:${expiryTimestamp}`;
  const hmacDigest = crypto.createHmac('sha256', config.SESSION_SECRET).update(tokenPayload).digest('hex');
  return Buffer.from(`${tokenPayload}:${hmacDigest}`).toString('base64');
}

function validateAdminAuthToken(rawTokenString) {
  if (!rawTokenString) return false;
  try {
    const decodedToken = Buffer.from(rawTokenString, 'base64').toString('utf8');
    const [principalName, expiryTimestampStr, signatureHash] = decodedToken.split(':');
    if (principalName !== 'admin') return false;

    const expiryTimestamp = Number(expiryTimestampStr);
    if (!expiryTimestamp || Date.now() > expiryTimestamp) return false;

    const expectedPayload = `${principalName}:${expiryTimestampStr}`;
    const expectedSignature = crypto.createHmac('sha256', config.SESSION_SECRET).update(expectedPayload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedSignature));
  } catch (parseErr) {
    return false;
  }
}

function requireAdminAuth(req, res, next) {
  const sessionCookieToken = req.cookies.admin_session;
  if (!validateAdminAuthToken(sessionCookieToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Admin login
adminEndpointRouter.post('/login', (req, res) => {
  const { username: submittedUsername, password: submittedPassword } = req.body;

  if (submittedUsername === config.ADMIN_USERNAME && submittedPassword === config.ADMIN_PASSWORD) {
    const freshSessionToken = createAdminAuthToken();

    res.cookie('admin_session', freshSessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
      maxAge: config.SESSION_MAX_AGE_MS
    });

    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
});

adminEndpointRouter.get('/me', requireAdminAuth, (req, res) => {
  res.json({ authenticated: true });
});

adminEndpointRouter.post('/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ success: true });
});

// Fetch all client submissions
adminEndpointRouter.get('/submissions', requireAdminAuth, async (req, res) => {
  try {
    const submissionRecords = await database.fetchAllSubmissions();
    res.json(submissionRecords);
  } catch (fetchErr) {
    console.error('Error fetching submissions:', fetchErr);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve submission
adminEndpointRouter.post('/submissions/:id/approve', requireAdminAuth, async (req, res) => {
  try {
    const submissionId = req.params.id;
    const targetRecord = await database.findSubmissionById(submissionId);
    if (!targetRecord) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const currentSavedPin = await database.retrieveConfigurationParam('global_pin');
    let effectivePin = req.body.pin || currentSavedPin || config.DEFAULT_PASSCODE;
    effectivePin = String(effectivePin).trim();

    await database.grantSubmissionApproval(submissionId, effectivePin);

    const targetRedirectUrl = await database.resolveTargetRedirectUrl();

    // Notify target user
    eventHub.broadcastToUser(targetRecord.user_token, {
      status: 'approved',
      reward_pin: effectivePin,
      redirect_url: targetRedirectUrl
    });

    // Notify all admin dashboards
    eventHub.broadcastToAllAdmins({
      type: 'submission_approved',
      id: Number(submissionId),
      pin: effectivePin,
      token: targetRecord.user_token
    });

    res.json({
      success: true,
      pin: effectivePin,
      username: targetRecord.username,
      coupon: targetRecord.submitted_coupon
    });
  } catch (approveErr) {
    console.error('Error approving submission:', approveErr);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject submission
adminEndpointRouter.post('/submissions/:id/reject', requireAdminAuth, async (req, res) => {
  try {
    const submissionId = req.params.id;
    const targetRecord = await database.findSubmissionById(submissionId);
    if (!targetRecord) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    await database.rejectSubmissionRecord(submissionId);

    eventHub.broadcastToUser(targetRecord.user_token, {
      status: 'rejected'
    });

    eventHub.broadcastToAllAdmins({
      type: 'submission_rejected',
      id: Number(submissionId),
      token: targetRecord.user_token
    });

    res.json({ success: true });
  } catch (rejectErr) {
    console.error('Error rejecting submission:', rejectErr);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PIN settings management
adminEndpointRouter.get('/settings', requireAdminAuth, async (req, res) => {
  try {
    const storedPin = await database.retrieveConfigurationParam('global_pin');
    res.json({
      global_pin: storedPin || config.DEFAULT_PASSCODE
    });
  } catch (paramErr) {
    console.error('Error getting settings:', paramErr);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminEndpointRouter.post('/settings', requireAdminAuth, async (req, res) => {
  try {
    const { global_pin: newPinValue } = req.body;

    if (newPinValue !== undefined) {
      await database.updateConfigurationParam('global_pin', String(newPinValue).trim());
    }

    const savedPinResult = await database.retrieveConfigurationParam('global_pin');
    res.json({
      success: true,
      global_pin: savedPinResult
    });
  } catch (updateErr) {
    console.error('Error saving settings:', updateErr);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SSE updates for admin dashboard
adminEndpointRouter.get('/events', requireAdminAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  eventHub.registerAdminStream(res);
});

module.exports = adminEndpointRouter;
