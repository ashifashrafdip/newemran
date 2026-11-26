const { neon } = require('@neondatabase/serverless');
const config = require('./config');

const connUri = config.DATABASE_URL;

let neonSql = null;
if (connUri) {
  try {
    neonSql = neon(connUri);
  } catch (initErr) {
    console.error('Failed to initialize Neon client:', initErr);
  }
}

// In-memory fallback if Neon DATABASE_URL is not set
const memoryStorage = {
  records: [],
  configs: {
    global_pin: config.DEFAULT_PASSCODE,
    redirect_url: ''
  },
  autoIncrementId: 1
};

let isSchemaReady = false;
async function initializeSchema() {
  if (!neonSql || isSchemaReady) return;
  try {
    await neonSql`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        user_token VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) NOT NULL,
        submitted_coupon VARCHAR(255) NOT NULL,
        reward_pin VARCHAR(20),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      );
    `;

    await neonSql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `;

    await neonSql`
      INSERT INTO settings (key, value)
      VALUES ('global_pin', ${config.DEFAULT_PASSCODE})
      ON CONFLICT (key) DO NOTHING;
    `;

    isSchemaReady = true;
  } catch (schemaErr) {
    console.error('Error initializing database tables:', schemaErr);
  }
}

module.exports = {
  initializeSchema,

  insertSubmissionRecord: async (sessionToken, clientIdentifier, verificationVoucher) => {
    if (neonSql) {
      await initializeSchema();
      const queryResults = await neonSql`
        INSERT INTO submissions (user_token, username, submitted_coupon, status, created_at)
        VALUES (${sessionToken}, ${clientIdentifier}, ${verificationVoucher}, 'pending', NOW())
        RETURNING id, user_token, username, submitted_coupon, reward_pin, status, created_at
      `;
      return queryResults[0];
    } else {
      const timestampIso = new Date().toISOString();
      const newEntry = {
        id: memoryStorage.autoIncrementId++,
        user_token: sessionToken,
        username: clientIdentifier,
        submitted_coupon: verificationVoucher,
        reward_pin: null,
        status: 'pending',
        created_at: timestampIso
      };
      memoryStorage.records.push(newEntry);
      return newEntry;
    }
  },

  findSubmissionByToken: async (sessionToken) => {
    if (neonSql) {
      await initializeSchema();
      const matchingRows = await neonSql`
        SELECT * FROM submissions WHERE user_token = ${sessionToken} LIMIT 1
      `;
      return matchingRows[0] || null;
    }
    return memoryStorage.records.find(item => item.user_token === sessionToken) || null;
  },

  findSubmissionById: async (recordId) => {
    if (neonSql) {
      await initializeSchema();
      const matchingRows = await neonSql`
        SELECT * FROM submissions WHERE id = ${Number(recordId)} LIMIT 1
      `;
      return matchingRows[0] || null;
    }
    return memoryStorage.records.find(item => item.id === Number(recordId)) || null;
  },

  fetchAllSubmissions: async () => {
    if (neonSql) {
      await initializeSchema();
      const allRows = await neonSql`
        SELECT * FROM submissions ORDER BY id DESC
      `;
      return allRows;
    }
    return [...memoryStorage.records].reverse();
  },

  grantSubmissionApproval: async (recordId, grantedPasscode) => {
    if (neonSql) {
      await initializeSchema();
      const updatedRows = await neonSql`
        UPDATE submissions
        SET status = 'approved', reward_pin = ${grantedPasscode}, decided_at = NOW()
        WHERE id = ${Number(recordId)}
        RETURNING *
      `;
      return updatedRows[0] || null;
    }
    const targetItem = memoryStorage.records.find(item => item.id === Number(recordId));
    if (targetItem) {
      targetItem.status = 'approved';
      targetItem.reward_pin = grantedPasscode;
      targetItem.decided_at = new Date().toISOString();
      return targetItem;
    }
    return null;
  },

  rejectSubmissionRecord: async (recordId) => {
    if (neonSql) {
      await initializeSchema();
      const updatedRows = await neonSql`
        UPDATE submissions
        SET status = 'rejected', decided_at = NOW()
        WHERE id = ${Number(recordId)}
        RETURNING *
      `;
      return updatedRows[0] || null;
    }
    const targetItem = memoryStorage.records.find(item => item.id === Number(recordId));
    if (targetItem) {
      targetItem.status = 'rejected';
      targetItem.decided_at = new Date().toISOString();
      return targetItem;
    }
    return null;
  },

  markSubmissionFinished: async (sessionToken) => {
    if (neonSql) {
      await initializeSchema();
      const updatedRows = await neonSql`
        UPDATE submissions
        SET status = 'completed', completed_at = NOW()
        WHERE user_token = ${sessionToken}
        RETURNING *
      `;
      return updatedRows[0] || null;
    }
    const targetItem = memoryStorage.records.find(item => item.user_token === sessionToken);
    if (targetItem) {
      targetItem.status = 'completed';
      targetItem.completed_at = new Date().toISOString();
      return targetItem;
    }
    return null;
  },

  retrieveConfigurationParam: async (paramKey) => {
    if (neonSql) {
      await initializeSchema();
      const matchingRows = await neonSql`
        SELECT value FROM settings WHERE key = ${paramKey} LIMIT 1
      `;
      return matchingRows[0] ? matchingRows[0].value : '';
    }
    return memoryStorage.configs[paramKey] || '';
  },

  updateConfigurationParam: async (paramKey, paramValue) => {
    if (neonSql) {
      await initializeSchema();
      await neonSql`
        INSERT INTO settings (key, value)
        VALUES (${paramKey}, ${paramValue})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return;
    }
    memoryStorage.configs[paramKey] = paramValue;
  },

  resolveTargetRedirectUrl: async () => {
    return config.REDIRECT_URL;
  }
};
