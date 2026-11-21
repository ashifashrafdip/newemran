const EventEmitter = require('events');
const eventBus = new EventEmitter();

// In-memory connected SSE clients
const userClients = new Map(); // token => res
const adminClients = new Set(); // res

function subscribeUser(token, res) {
  userClients.set(token, res);
  res.on('close', () => {
    userClients.delete(token);
  });
}

function notifyUser(token, data) {
  const client = userClients.get(token);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function subscribeAdmin(res) {
  adminClients.add(res);
  res.on('close', () => {
    adminClients.delete(res);
  });
}

function notifyAdmins(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of adminClients) {
    client.write(payload);
  }
}

module.exports = {
  subscribeUser,
  notifyUser,
  subscribeAdmin,
  notifyAdmins
};
