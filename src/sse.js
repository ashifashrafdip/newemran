// Real-time Event Broadcaster across open client connections
const connectedUserConnections = new Map(); // sessionToken => responseObj
const activeAdminConnections = new Set(); // responseObj

function registerUserStream(sessionToken, responseObj) {
  connectedUserConnections.set(sessionToken, responseObj);
  responseObj.on('close', () => {
    connectedUserConnections.delete(sessionToken);
  });
}

function broadcastToUser(sessionToken, eventPayload) {
  const targetedClient = connectedUserConnections.get(sessionToken);
  if (targetedClient) {
    targetedClient.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  }
}

function registerAdminStream(responseObj) {
  activeAdminConnections.add(responseObj);
  responseObj.on('close', () => {
    activeAdminConnections.delete(responseObj);
  });
}

function broadcastToAllAdmins(eventPayload) {
  const serializedMsg = `data: ${JSON.stringify(eventPayload)}\n\n`;
  for (const adminSubscriber of activeAdminConnections) {
    try {
      adminSubscriber.write(serializedMsg);
    } catch (writeErr) {
      activeAdminConnections.delete(adminSubscriber);
    }
  }
}

module.exports = {
  registerUserStream,
  broadcastToUser,
  registerAdminStream,
  broadcastToAllAdmins
};
