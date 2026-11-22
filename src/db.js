const { neon } = require('@neondatabase/serverless');

// Database connection string from environment variable (Neon Serverless PostgreSQL)
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;

let sql = null;
if (DATABASE_URL) {
  try {
    sql = neon(DATABASE_URL);
  } catch (err) {
    console.error('Failed to initialize Neon client:', err);
  }
}

// In-memory fallback if DATABASE_URL is not set (e.g. initial local dev)
const inMemoryData = {
  submissions: [],
  settings: {
    global_pin: '1234',
    redirect_url: ''
  },
  nextId: 1
};

// Initialize Neon table schemas on demand
let tablesInitialized = false;
async function ensureTables() {
  if (!sql || tablesInitialized) return;
  try {
    await sql`
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

    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `;

    await sql`
      INSERT INTO settings (key, value)
      VALUES ('global_pin', '1234')
      ON CONFLICT (key) DO NOTHING;
    `;

    tablesInitialized = true;
  } catch (err) {
    console.error('Error creating Neon tables:', err);
  }
}

module.exports = {
  ensureTables,

  createSubmission: async (token, username, coupon) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        INSERT INTO submissions (user_token, username, submitted_coupon, status, created_at)
        VALUES (${token}, ${username}, ${coupon}, 'pending', NOW())
        RETURNING id, user_token, username, submitted_coupon, reward_pin, status, created_at
      `;
      return rows[0];
    } else {
      const now = new Date().toISOString();
      const sub = {
        id: inMemoryData.nextId++,
        user_token: token,
        username,
        submitted_coupon: coupon,
        reward_pin: null,
        status: 'pending',
        created_at: now
      };
      inMemoryData.submissions.push(sub);
      return sub;
    }
  },

  getSubmissionByToken: async (token) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        SELECT * FROM submissions WHERE user_token = ${token} LIMIT 1
      `;
      return rows[0] || null;
    }
    return inMemoryData.submissions.find(s => s.user_token === token) || null;
  },

  getSubmissionById: async (id) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        SELECT * FROM submissions WHERE id = ${Number(id)} LIMIT 1
      `;
      return rows[0] || null;
    }
    return inMemoryData.submissions.find(s => s.id === Number(id)) || null;
  },

  getAllSubmissions: async () => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        SELECT * FROM submissions ORDER BY id DESC
      `;
      return rows;
    }
    return [...inMemoryData.submissions].reverse();
  },

  approveSubmission: async (id, pin) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        UPDATE submissions
        SET status = 'approved', reward_pin = ${pin}, decided_at = NOW()
        WHERE id = ${Number(id)}
        RETURNING *
      `;
      return rows[0] || null;
    }
    const sub = inMemoryData.submissions.find(s => s.id === Number(id));
    if (sub) {
      sub.status = 'approved';
      sub.reward_pin = pin;
      sub.decided_at = new Date().toISOString();
      return sub;
    }
    return null;
  },

  rejectSubmission: async (id) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        UPDATE submissions
        SET status = 'rejected', decided_at = NOW()
        WHERE id = ${Number(id)}
        RETURNING *
      `;
      return rows[0] || null;
    }
    const sub = inMemoryData.submissions.find(s => s.id === Number(id));
    if (sub) {
      sub.status = 'rejected';
      sub.decided_at = new Date().toISOString();
      return sub;
    }
    return null;
  },

  completeSubmission: async (token) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        UPDATE submissions
        SET status = 'completed', completed_at = NOW()
        WHERE user_token = ${token}
        RETURNING *
      `;
      return rows[0] || null;
    }
    const sub = inMemoryData.submissions.find(s => s.user_token === token);
    if (sub) {
      sub.status = 'completed';
      sub.completed_at = new Date().toISOString();
      return sub;
    }
    return null;
  },

  getSetting: async (key) => {
    if (sql) {
      await ensureTables();
      const rows = await sql`
        SELECT value FROM settings WHERE key = ${key} LIMIT 1
      `;
      return rows[0] ? rows[0].value : '';
    }
    return inMemoryData.settings[key] || '';
  },

  setSetting: async (key, value) => {
    if (sql) {
      await ensureTables();
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return;
    }
    inMemoryData.settings[key] = value;
  },

  getRedirectUrl: async () => {
    return process.env.REDIRECT_URL || process.env.DEFAULT_REDIRECT_URL || 'https://google.com';
  }
};
