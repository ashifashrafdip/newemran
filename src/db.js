let sqliteModule;
try {
  sqliteModule = require('node:sqlite');
} catch (e) {
  sqliteModule = null;
}

const path = require('path');
const fs = require('fs');

const isVercel = process.env.VERCEL || process.env.NOW_REGION;
const dataDir = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {}
}

const dbPath = path.join(dataDir, 'app.db');

let db = null;
let useFallback = false;

// In-memory fallback if node:sqlite is not supported on older Vercel Node runtime
const inMemoryData = {
  submissions: [],
  settings: {
    global_pin: '1234',
    redirect_url: ''
  },
  nextId: 1
};

if (sqliteModule && sqliteModule.DatabaseSync) {
  try {
    db = new sqliteModule.DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_token TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        submitted_coupon TEXT NOT NULL,
        reward_pin TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        decided_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const checkPinStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    if (!checkPinStmt.get('global_pin')) {
      const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      insertStmt.run('global_pin', '1234');
    }
  } catch (err) {
    console.error('SQLite init failed, falling back to memory/file store:', err);
    useFallback = true;
  }
} else {
  useFallback = true;
}

module.exports = {
  createSubmission: (token, username, coupon) => {
    const now = new Date().toISOString();
    if (!useFallback && db) {
      const stmt = db.prepare(`
        INSERT INTO submissions (user_token, username, submitted_coupon, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `);
      const result = stmt.run(token, username, coupon, now);
      return {
        id: Number(result.lastInsertRowid),
        user_token: token,
        username,
        submitted_coupon: coupon,
        reward_pin: null,
        status: 'pending',
        created_at: now
      };
    } else {
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
  getSubmissionByToken: (token) => {
    if (!useFallback && db) {
      const stmt = db.prepare('SELECT * FROM submissions WHERE user_token = ?');
      return stmt.get(token);
    }
    return inMemoryData.submissions.find(s => s.user_token === token);
  },
  getSubmissionById: (id) => {
    if (!useFallback && db) {
      const stmt = db.prepare('SELECT * FROM submissions WHERE id = ?');
      return stmt.get(id);
    }
    return inMemoryData.submissions.find(s => s.id === Number(id));
  },
  getAllSubmissions: () => {
    if (!useFallback && db) {
      const stmt = db.prepare('SELECT * FROM submissions ORDER BY id DESC');
      return stmt.all();
    }
    return [...inMemoryData.submissions].reverse();
  },
  approveSubmission: (id, pin) => {
    const now = new Date().toISOString();
    if (!useFallback && db) {
      const stmt = db.prepare(`
        UPDATE submissions
        SET status = 'approved', reward_pin = ?, decided_at = ?
        WHERE id = ?
      `);
      stmt.run(pin, now, id);
      return stmt.changes;
    }
    const sub = inMemoryData.submissions.find(s => s.id === Number(id));
    if (sub) {
      sub.status = 'approved';
      sub.reward_pin = pin;
      sub.decided_at = now;
      return 1;
    }
    return 0;
  },
  rejectSubmission: (id) => {
    const now = new Date().toISOString();
    if (!useFallback && db) {
      const stmt = db.prepare(`
        UPDATE submissions
        SET status = 'rejected', decided_at = ?
        WHERE id = ?
      `);
      stmt.run(now, id);
      return stmt.changes;
    }
    const sub = inMemoryData.submissions.find(s => s.id === Number(id));
    if (sub) {
      sub.status = 'rejected';
      sub.decided_at = now;
      return 1;
    }
    return 0;
  },
  completeSubmission: (token) => {
    const now = new Date().toISOString();
    if (!useFallback && db) {
      const stmt = db.prepare(`
        UPDATE submissions
        SET status = 'completed', completed_at = ?
        WHERE user_token = ?
      `);
      stmt.run(now, token);
      return stmt.changes;
    }
    const sub = inMemoryData.submissions.find(s => s.user_token === token);
    if (sub) {
      sub.status = 'completed';
      sub.completed_at = now;
      return 1;
    }
    return 0;
  },
  getSetting: (key) => {
    if (!useFallback && db) {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key);
      return row ? row.value : '';
    }
    return inMemoryData.settings[key] || '';
  },
  setSetting: (key, value) => {
    if (!useFallback && db) {
      const stmt = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      stmt.run(key, value);
      return;
    }
    inMemoryData.settings[key] = value;
  },
  getRedirectUrl: () => {
    return process.env.REDIRECT_URL || process.env.DEFAULT_REDIRECT_URL || 'https://google.com';
  }
};
