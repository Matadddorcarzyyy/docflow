import express from 'express';
import dotenv from 'dotenv';
// path is already imported above
import { fileURLToPath } from 'url';
// Load .env explicitly from server root (../.env relative to src/index.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const { Pool } = pkg;

const app = express();
app.use(helmet());
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use(express.json({ limit: '1mb' }));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без Origin (curl, same-origin) и file:// (Origin=null)
    if (!origin || origin === 'null') return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'), false);
  }
}));

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || 'postgres://docflow:docflow_password@db:5432/docflow',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// static uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// static files (HTML, CSS, JS)
const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
} else {
  // fallback to parent directory for static files
  app.use(express.static(path.join(process.cwd(), '..')));
}
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

// ---- Auth helpers ----
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret_change_me';

function signToken(payload) {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireRoles(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
}

app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    res.json({ ok: true, db: false, error: e.message });
  }
});

// ---- Auth endpoints ----
app.post('/api/auth/register', async (req, res) => {
  const { email, password, role, full_name } = req.body || {};
  const allowed = ['lawyer','admin','owner','partner'];
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (role && !allowed.includes(role)) return res.status(400).json({ error: 'invalid role' });
  try {
    const password_hash = await bcrypt.hash(String(password), 10);
    const { rows } = await pool.query(
      'insert into users (email, password_hash, role, full_name) values ($1,$2,$3,$4) returning id, email, role, full_name',
      [String(email).toLowerCase(), password_hash, role || 'lawyer', full_name || null]
    );
    const user = rows[0];
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    return res.status(201).json({ token, user });
  } catch (e) {
    if (String(e.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'email_exists' });
    }
    return res.status(500).json({ error: 'register_failed', details: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const { rows } = await pool.query('select id, email, role, password_hash, full_name from users where email=$1', [String(email).toLowerCase()]);
    if (!rows[0]) return res.status(401).json({ error: 'invalid_credentials' });
    const match = await bcrypt.compare(String(password), rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'invalid_credentials' });
    const user = { id: rows[0].id, email: rows[0].email, role: rows[0].role, full_name: rows[0].full_name };
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    return res.json({ token, user });
  } catch (e) {
    return res.status(500).json({ error: 'login_failed', details: e.message });
  }
});

// whoami
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('select id, email, role, full_name from users where id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    return res.json(rows[0]);
  } catch (e) {
    return res.status(500).json({ error: 'me_failed', details: e.message });
  }
});

// Documents catalog
app.get('/api/documents', async (req, res) => {
  try {
    const { rows } = await pool.query('select id, title, base_price from documents order by id asc');
    res.json(rows);
  } catch (e) {
    // Fallback to static data when database is not available
    console.log('[api] Using fallback documents data');
    res.json([
      { id: 1, title: 'Договор купли-продажи', base_price: 5000 },
      { id: 2, title: 'Договор аренды', base_price: 3000 },
      { id: 3, title: 'Трудовой договор', base_price: 4000 },
      { id: 4, title: 'Договор подряда', base_price: 3500 },
      { id: 5, title: 'Договор займа', base_price: 2500 }
    ]);
  }
});

// Public vacancies list
app.get('/api/vacancies', async (req, res) => {
  const { rows } = await pool.query(
    'select id, title, description, location, employment_type, salary_min, salary_max, is_active, created_at from vacancies where is_active=true order by id desc'
  );
  res.json(rows);
});

// Admin vacancies CRUD
app.post('/api/vacancies', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { title, description, location, employment_type, salary_min, salary_max, is_active } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const { rows } = await pool.query(
    'insert into vacancies (title, description, location, employment_type, salary_min, salary_max, is_active) values ($1,$2,$3,$4,$5,$6,coalesce($7,true)) returning id, title, description, location, employment_type, salary_min, salary_max, is_active',
    [title, description || null, location || null, employment_type || null, salary_min || null, salary_max || null, is_active]
  );
  res.status(201).json(rows[0]);
});

app.get('/api/vacancies/admin', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { rows } = await pool.query('select * from vacancies order by id desc');
  res.json(rows);
});

app.put('/api/vacancies/:id', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { id } = req.params;
  const { title, description, location, employment_type, salary_min, salary_max, is_active } = req.body || {};
  const { rowCount } = await pool.query(
    'update vacancies set title=coalesce($1,title), description=coalesce($2,description), location=coalesce($3,location), employment_type=coalesce($4,employment_type), salary_min=coalesce($5,salary_min), salary_max=coalesce($6,salary_max), is_active=coalesce($7,is_active), updated_at=now() where id=$8',
    [title || null, description || null, location || null, employment_type || null, salary_min || null, salary_max || null, typeof is_active === 'boolean' ? is_active : null, id]
  );
  res.json({ ok: rowCount > 0 });
});

app.delete('/api/vacancies/:id', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { id } = req.params;
  await pool.query('delete from vacancies where id=$1', [id]);
  res.json({ ok: true });
});

// Settings: privacy policy get/update
app.get('/api/settings/privacy', async (req, res) => {
  const { rows } = await pool.query("select value from settings where key='privacy_policy_html'");
  res.json({ html: (rows[0] && rows[0].value) || '' });
});

app.put('/api/settings/privacy', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { html } = req.body || {};
  if (typeof html !== 'string') return res.status(400).json({ error: 'html string required' });
  await pool.query(
    "insert into settings(key, value, updated_at) values ('privacy_policy_html', $1, now()) on conflict (key) do update set value=excluded.value, updated_at=now()",
    [html]
  );
  res.json({ ok: true });
});

// Users list for admin
app.get('/api/users', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const role = (req.query.role || '').toString();
  let q = 'select id, email, role, full_name, created_at from users';
  const args = [];
  if (role) { q += ' where role=$1'; args.push(role); }
  q += ' order by id desc limit 200';
  const { rows } = await pool.query(q, args);
  const withOnline = rows.map((u) => {
    const p = presence.get(String(u.id));
    return { ...u, online: Boolean(p && p.sockets && p.sockets.size > 0) };
  });
  res.json(withOnline);
});

// Admin documents CRUD
app.post('/api/documents', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { title, base_price } = req.body || {};
  if (!title || !base_price) return res.status(400).json({ error: 'title, base_price required' });
  const { rows } = await pool.query('insert into documents (title, base_price) values ($1,$2) returning id, title, base_price', [title, base_price]);
  try { if (ioRef) ioRef.emit('documents-updated'); } catch(e) {}
  res.status(201).json(rows[0]);
});
app.put('/api/documents/:id', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { id } = req.params;
  const { title, base_price } = req.body || {};
  const { rowCount } = await pool.query('update documents set title=coalesce($1,title), base_price=coalesce($2,base_price) where id=$3', [title || null, base_price || null, id]);
  try { if (ioRef) ioRef.emit('documents-updated'); } catch(e) {}
  res.json({ ok: rowCount > 0 });
});
app.delete('/api/documents/:id', authMiddleware, requireRoles(['admin','owner']), async (req, res) => {
  const { id } = req.params;
  await pool.query('delete from documents where id=$1', [id]);
  try { if (ioRef) ioRef.emit('documents-updated'); } catch(e) {}
  res.json({ ok: true });
});

// List files of chat
app.get('/api/chats/:chatId/files', authMiddleware, requireRoles(['lawyer','admin','owner']), async (req, res) => {
  const { chatId } = req.params;
  const { rows } = await pool.query('select id, uploader_role, original_name, url, created_at from files where chat_id=$1 order by id desc', [chatId]);
  res.json(rows);
});

// Create chat message
app.post('/api/chats/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const { sender, text } = req.body || {};
  if (!sender || !text) return res.status(400).json({ error: 'sender and text are required' });
  const { rows } = await pool.query('insert into messages (chat_id, sender, text) values ($1, $2, $3) returning id, created_at', [chatId, sender, text]);
  try {
    const hook = process.env.N8N_WEBHOOK_URL;
    if (hook) {
      await axios.post(hook.replace(/\/$/, '') + '/new-message', { chatId: Number(chatId), sender, text, created_at: rows[0].created_at });
    }
  } catch(e) {}
  res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
});

// Create order
app.post('/api/orders', async (req, res) => {
  const { document_id, email, price, payload } = req.body || {};
  if (!document_id || !email || !price) return res.status(400).json({ error: 'document_id, email, price required' });
  const { rows } = await pool.query('insert into orders (document_id, email, price, payload) values ($1, $2, $3, $4) returning id, created_at', [document_id, email, price, payload || {}]);
  res.status(201).json(rows[0]);
});

// Payments: unified start endpoint
app.post('/api/payments/start', async (req, res) => {
  const { provider, order_id, amount, description, email } = req.body || {};
  if (!provider || !order_id || !amount) return res.status(400).json({ error: 'provider, order_id, amount required' });
  const p = String(provider).toLowerCase();
  try {
    await pool.query('update orders set status=$1, provider=$2 where id=$3', ['pending', p, order_id]);
  } catch (e) {}

  if (p === 'yookassa') {
    try {
      const shopId = process.env.YOOKASSA_SHOP_ID;
      const secret = process.env.YOOKASSA_SECRET_KEY;
      const returnUrl = process.env.PAY_RETURN_URL || 'https://your-frontend-hostia.net/index.html';
      const idempotenceKey = 'yk_' + order_id + '_' + Date.now();
      const r = await axios.post('https://api.yookassa.ru/v3/payments', {
        amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: returnUrl },
        description: description || `Order #${order_id}`,
        metadata: { order_id }
      }, {
        headers: {
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json'
        },
        auth: { username: shopId, password: secret }
      });
      const url = r.data && r.data.confirmation && r.data.confirmation.confirmation_url;
      await pool.query('update orders set external_id=$1 where id=$2', [r.data && r.data.id, order_id]);
      return res.json({ provider: p, url, order_id, amount, description, email });
    } catch (e) {
      return res.status(500).json({ error: 'yookassa_error', details: e.message });
    }
  }

  // fallback demo links for other providers
  const base = {
    cloudpayments: 'https://checkout.cloudpayments.ru/demo',
    stripe: 'https://checkout.stripe.com/pay/demo'
  }[p] || 'https://example.com/pay/demo';
  const url = `${base}?order=${encodeURIComponent(order_id)}&amount=${encodeURIComponent(amount)}`;
  return res.json({ provider: p, url, order_id, amount, description, email });
});

// Payments webhooks (stubs)
app.post('/api/payments/webhook/yookassa', express.json(), async (req, res) => {
  // TODO: validate signature and update order status
  try {
    const external_id = req.body && (req.body.object && req.body.object.id);
    const status = req.body && (req.body.object && req.body.object.status);
    if (req.body && req.body.object && req.body.object.metadata && req.body.object.metadata.order_id) {
      const orderId = req.body.object.metadata.order_id;
      await pool.query('update orders set status=$1, external_id=$2 where id=$3', [status || 'paid', external_id || null, orderId]);
    }
  } catch (e) {}
  res.json({ ok: true });
});
app.post('/api/payments/webhook/cloudpayments', express.json(), async (req, res) => {
  res.json({ ok: true });
});
app.post('/api/payments/webhook/stripe', express.json(), async (req, res) => {
  res.json({ ok: true });
});

// n8n trigger webhook stubs
app.post('/api/hooks/lawyer-login', async (req, res) => {
  // TODO: forward to n8n webhook URL with payload { email, timestamp }
  res.json({ ok: true });
});
app.post('/api/hooks/new-message', async (req, res) => {
  // TODO: forward to n8n for notifications
  res.json({ ok: true });
});

// AI integration stubs
app.post('/api/ai/draft', async (req, res) => {
  // TODO: call Ollama or external providers with prompt and context
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  res.json({ draft: 'Черновик документа (заглушка).', provider: 'stub' });
});
app.post('/api/ai/embedding', async (req, res) => {
  // TODO: call embeddings provider and store vector in pgvector
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json({ vector: [0.01, 0.02, 0.03], provider: 'stub' });
});

// ---- Chats API ----
// Create chat (visitor starts), returns chat id
app.post('/api/chats', async (req, res) => {
  const { visitor_id } = req.body || {};
  const { rows } = await pool.query('insert into chats (visitor_id) values ($1) returning id, created_at', [visitor_id || null]);
  res.status(201).json(rows[0]);
});

// List chats (restricted to staff)
app.get('/api/chats', authMiddleware, requireRoles(['lawyer','admin','owner']), async (req, res) => {
  const { rows } = await pool.query('select id, visitor_id, created_at from chats order by id desc limit 50');
  res.json(rows);
});

// List messages in chat
app.get('/api/chats/:chatId/messages', authMiddleware, requireRoles(['lawyer','admin','owner']), async (req, res) => {
  const { chatId } = req.params;
  const { rows } = await pool.query('select id, sender, text, created_at from messages where chat_id=$1 order by id asc limit 200', [chatId]);
  res.json(rows);
});

// Upload file to chat
app.post('/api/chats/:chatId/upload', authMiddleware, requireRoles(['lawyer','admin','owner']), upload.single('file'), async (req, res) => {
  const { chatId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  // Save a system message with file link (simplified)
  const url = `/uploads/${req.file.filename}`;
  try {
    await pool.query('insert into files (chat_id, uploader_role, original_name, stored_name, url) values ($1,$2,$3,$4,$5)', [chatId, req.user && req.user.role ? req.user.role : 'lawyer', req.file.originalname || null, req.file.filename, url]);
  } catch(e) {}
  await pool.query('insert into messages (chat_id, sender, text) values ($1,$2,$3)', [chatId, 'lawyer', `Файл: ${url}`]);
  res.status(201).json({ url, original: req.file.originalname || null });
});

// ---- Socket.IO ----
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      // allow no origin (same-origin/ws) and file:// (Origin=null)
      if (!origin || origin === 'null') return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    }
  }
});
const ioRef = io; // reference for broadcasting from HTTP handlers

// Presence storage
const presence = new Map(); // userId -> { sockets:Set<string>, lastSeen:Date }

io.on('connection', (socket) => {
  // Optional auth via token for presence
  socket.on('auth', (data) => {
    try {
      const token = data && data.token;
      if (!token) return;
      const decoded = jwt.verify(token, SESSION_SECRET);
      socket.data.user = { id: decoded.id, role: decoded.role };
      if (decoded && (decoded.role === 'lawyer' || decoded.role === 'admin' || decoded.role === 'owner')) {
        const key = String(decoded.id);
        const info = presence.get(key) || { sockets: new Set(), lastSeen: new Date() };
        info.sockets.add(socket.id);
        info.lastSeen = new Date();
        presence.set(key, info);
        io.emit('presence-user', { userId: Number(key), online: true });
      }
    } catch(e) {}
  });

  socket.on('join-chat', ({ chatId }) => {
    if (!chatId) return;
    socket.join(`chat-${chatId}`);
    socket.to(`chat-${chatId}`).emit('presence', { chatId, online: true });
  });

  socket.on('typing', ({ chatId, isTyping, sender }) => {
    if (!chatId) return;
    socket.to(`chat-${chatId}`).emit('typing', { chatId, isTyping: Boolean(isTyping), sender });
  });

  socket.on('message', async ({ chatId, sender, text }) => {
    if (!chatId || !sender || !text) return;
    try {
      const { rows } = await pool.query('insert into messages (chat_id, sender, text) values ($1, $2, $3) returning id, text, created_at', [chatId, sender, text]);
      io.to(`chat-${chatId}`).emit('message', { id: rows[0].id, chatId, sender, text: rows[0].text, created_at: rows[0].created_at });
      try {
        const hook = process.env.N8N_WEBHOOK_URL;
        if (hook) {
          await axios.post(hook.replace(/\/$/, '') + '/new-message', { chatId: Number(chatId), sender, text, created_at: rows[0].created_at });
        }
      } catch(e) {}
    } catch (e) {
      // swallow
    }
  });

  socket.on('disconnecting', () => {
    const user = socket.data && socket.data.user;
    if (!user) return;
    const key = String(user.id);
    const info = presence.get(key);
    if (!info) return;
    info.sockets.delete(socket.id);
    info.lastSeen = new Date();
    if (info.sockets.size === 0) {
      presence.delete(key);
      io.emit('presence-user', { userId: Number(key), online: false });
    } else {
      presence.set(key, info);
    }
  });
});

const port = process.env.PORT || 8080;

// Stats for owner/admin
app.get('/api/stats', authMiddleware, requireRoles(['owner','admin']), async (req, res) => {
  const [users, chats, msgs, orders] = await Promise.all([
    pool.query("select role, count(*)::int as c from users group by role"),
    pool.query('select count(*)::int as c from chats'),
    pool.query('select count(*)::int as c from messages'),
    pool.query("select status, count(*)::int as c from orders group by status")
  ]);
  res.json({ users: users.rows, chats: chats.rows[0].c, messages: msgs.rows[0].c, orders: orders.rows });
});

// ---- Bootstrap owner ----
async function ensureAuxTables() {
  try {
    // Test database connection first
    await pool.query('SELECT 1');
    console.log('[bootstrap] Database connection successful');
    
    // Ensure settings table
    await pool.query(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now())"
    );
    console.log('[bootstrap] Settings table ensured');
    
    // Seed privacy key if missing
    await pool.query(
      "INSERT INTO settings(key, value) VALUES ('privacy_policy_html', '<p>Политика конфиденциальности будет размещена здесь.</p>') ON CONFLICT (key) DO NOTHING"
    );
    console.log('[bootstrap] Privacy policy seeded');

    // Ensure vacancies table
    await pool.query(
      "CREATE TABLE IF NOT EXISTS vacancies (\n      id SERIAL PRIMARY KEY,\n      title TEXT NOT NULL,\n      description TEXT,\n      location TEXT,\n      employment_type TEXT,\n      salary_min INTEGER,\n      salary_max INTEGER,\n      is_active BOOLEAN NOT NULL DEFAULT TRUE,\n      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),\n      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()\n    )"
    );
    await pool.query("CREATE INDEX IF NOT EXISTS vacancies_active_idx ON vacancies(is_active)");
    console.log('[bootstrap] Vacancies table ensured');
    
    // Ensure documents table has some default data
    const { rows: docRows } = await pool.query('SELECT COUNT(*) as count FROM documents');
    if (docRows[0].count === '0') {
      await pool.query(`
        INSERT INTO documents (title, base_price) VALUES 
        ('Договор купли-продажи', 5000),
        ('Договор аренды', 3000),
        ('Трудовой договор', 4000),
        ('Договор подряда', 3500),
        ('Договор займа', 2500)
        ON CONFLICT DO NOTHING
      `);
      console.log('[bootstrap] Default documents seeded');
    }
    
  } catch (e) {
    console.error('[bootstrap] Database error:', e.message);
    throw e;
  }
}
async function ensureOwnerAccount() {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const adminName = process.env.ADMIN_FULL_NAME || 'Owner';
  if (!adminEmail || !adminPassword) {
    console.log('[bootstrap] ADMIN_EMAIL/ADMIN_PASSWORD не заданы — пропуск создания владельца');
    return;
  }
  try {
    const { rows } = await pool.query('select id from users where email=$1', [adminEmail]);
    const password_hash = await bcrypt.hash(String(adminPassword), 10);
    if (!rows[0]) {
      await pool.query(
        'insert into users (email, password_hash, role, full_name) values ($1,$2,$3,$4)',
        [adminEmail, password_hash, 'owner', adminName]
      );
      console.log('[bootstrap] Создан владелец:', adminEmail);
    } else {
      await pool.query('update users set password_hash=$1, role=$2 where email=$3', [password_hash, 'owner', adminEmail]);
      console.log('[bootstrap] Обновлён владелец:', adminEmail);
    }
  } catch (e) {
    console.error('[bootstrap] Ошибка создания владельца:', e.message);
    throw e;
  }
}

(async () => {
  let dbReady = false;
  
  try {
    await ensureAuxTables();
    dbReady = true;
    console.log('[bootstrap] Database initialization successful');
  } catch (e) {
    console.error('[bootstrap] Ошибка ensureAuxTables:', e.message);
    console.log('[bootstrap] Продолжаем без базы данных...');
  }
  
  try {
    if (dbReady) {
      await ensureOwnerAccount();
    }
  } catch (e) {
    console.error('[bootstrap] Ошибка создания владельца:', e.message);
  }
  
  // Start server regardless of database status
  server.listen(port, () => {
    console.log(`API + WS listening on ${port}`);
    if (dbReady) {
      console.log('[bootstrap] ✅ Database ready');
    } else {
      console.log('[bootstrap] ⚠️  Database not ready - some features may not work');
    }
  });
})();

// --- Encoding + optional mojibake fix for seed data ---
(async () => {
  try {
    await pool.query("SET client_encoding TO 'UTF8'");
  } catch (e) {
    console.warn('[encoding] cannot enforce client_encoding UTF8:', e.message);
  }
  if (String(process.env.FIX_MOJIBAKE || '') === '1') {
    try {
      await pool.query('delete from documents');
      await pool.query("insert into documents (title, base_price) values \
        ('Договор дарения', 500), \
        ('Договор купли-продажи автомобиля', 700), \
        ('Договор купли-продажи квартиры', 900), \
        ('Договор аренды квартиры', 600), \
        ('Договор оказания услуг', 650)");
      console.log('[encoding] reseeded documents with UTF-8 titles');
    } catch (e) {
      console.error('[encoding] reseed failed:', e.message);
    }
  }
})();


