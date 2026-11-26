const express = require('express');
const crypto = require('crypto');
const database = require('../db');
const eventHub = require('../sse');

const userEndpointRouter = express.Router();

function createSecureSessionIdentifier() {
  return 'usr_' + crypto.randomBytes(8).toString('hex');
}

// Submit username & coupon
userEndpointRouter.post('/submissions', async (clientReq, clientRes) => {
  try {
    const { username: rawUsername, coupon: rawCoupon } = clientReq.body;
    if (!rawUsername || !rawCoupon) {
      return clientRes.status(400).json({ error: 'Username and coupon are required' });
    }

    const uniqueSessionToken = createSecureSessionIdentifier();
    const createdSubmission = await database.insertSubmissionRecord(
      uniqueSessionToken,
      rawUsername.trim(),
      rawCoupon.trim()
    );

    // Notify all active admin dashboards
    eventHub.broadcastToAllAdmins({ type: 'new_submission', submission: createdSubmission });

    clientRes.json({ success: true, token: uniqueSessionToken });
  } catch (routeErr) {
    console.error('Error in POST /submissions:', routeErr);
    clientRes.status(500).json({ error: 'Internal server error' });
  }
});

// Check verification status
userEndpointRouter.get('/submissions/:token/status', async (clientReq, clientRes) => {
  try {
    const targetSessionToken = clientReq.params.token;
    const existingSubmission = await database.findSubmissionByToken(targetSessionToken);
    if (!existingSubmission) {
      return clientRes.status(404).json({ error: 'Submission not found' });
    }

    const destinationUrl = await database.resolveTargetRedirectUrl();
    const clientStatusPayload = {
      status: existingSubmission.status,
      username: existingSubmission.username
    };

    if (existingSubmission.status === 'approved' || existingSubmission.status === 'completed') {
      clientStatusPayload.reward_pin = existingSubmission.reward_pin;
      clientStatusPayload.redirect_url = destinationUrl;
    }

    clientRes.json(clientStatusPayload);
  } catch (routeErr) {
    console.error('Error in GET /submissions/:token/status:', routeErr);
    clientRes.status(500).json({ error: 'Internal server error' });
  }
});

// SSE event stream for waiting client
userEndpointRouter.get('/submissions/:token/events', async (clientReq, clientRes) => {
  try {
    const targetSessionToken = clientReq.params.token;
    const existingSubmission = await database.findSubmissionByToken(targetSessionToken);
    if (!existingSubmission) {
      return clientRes.status(404).end();
    }

    clientRes.setHeader('Content-Type', 'text/event-stream');
    clientRes.setHeader('Cache-Control', 'no-cache');
    clientRes.setHeader('Connection', 'keep-alive');
    clientRes.flushHeaders();

    const destinationUrl = await database.resolveTargetRedirectUrl();

    if (existingSubmission.status === 'approved' || existingSubmission.status === 'rejected') {
      const immediateEventData = {
        status: existingSubmission.status,
        reward_pin: existingSubmission.reward_pin,
        redirect_url: destinationUrl
      };
      clientRes.write(`data: ${JSON.stringify(immediateEventData)}\n\n`);
      return;
    }

    eventHub.registerUserStream(targetSessionToken, clientRes);
  } catch (routeErr) {
    console.error('Error in SSE /submissions/:token/events:', routeErr);
    clientRes.status(500).end();
  }
});

// Complete flow and redirect
userEndpointRouter.post('/submissions/:token/complete', async (clientReq, clientRes) => {
  try {
    const targetSessionToken = clientReq.params.token;
    const existingSubmission = await database.findSubmissionByToken(targetSessionToken);
    if (!existingSubmission) {
      return clientRes.status(404).json({ error: 'Submission not found' });
    }

    await database.markSubmissionFinished(targetSessionToken);
    eventHub.broadcastToAllAdmins({ type: 'status_updated', token: targetSessionToken, status: 'completed' });

    const destinationUrl = await database.resolveTargetRedirectUrl();
    clientRes.json({
      success: true,
      redirect_url: destinationUrl
    });
  } catch (routeErr) {
    console.error('Error in POST /submissions/:token/complete:', routeErr);
    clientRes.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = userEndpointRouter;
