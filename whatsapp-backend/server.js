import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import P from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const sessions = new Map();
const logger = P({ level: process.env.LOG_LEVEL || 'info' });

fs.mkdirSync(DATA_DIR, { recursive: true });

function cleanName(value = '') {
  return String(value || '').trim().replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 80) || 'WhatsApp';
}

function sessionIdFromName(name = '') {
  return `session_${cleanName(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'whatsapp'}`;
}

function publicSession(session) {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    qrCode: session.qrCode || '',
    phone: session.phone || '',
    progress: session.progress || '',
    error: session.error || '',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

async function stopSession(id, removeFiles = false) {
  const session = sessions.get(id);
  if (session?.sock) {
    try { await session.sock.logout(); } catch {}
    try { session.sock.end?.(); } catch {}
  }
  sessions.delete(id);
  if (removeFiles) {
    fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
  }
}

async function startSession(name) {
  const safeName = cleanName(name);
  const id = sessionIdFromName(safeName);
  const existing = sessions.get(id);
  if (existing && ['initializing', 'pending', 'connected'].includes(existing.status)) {
    return existing;
  }

  const session = {
    id,
    name: safeName,
    status: 'initializing',
    qrCode: '',
    phone: '',
    progress: 'Abrindo WhatsApp Web',
    error: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sock: null
  };
  sessions.set(id, session);

  const authDir = path.join(DATA_DIR, id);
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ session: id }),
    browser: ['Solaire CRM', 'Chrome', '1.0'],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000
  });

  session.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    session.updatedAt = new Date().toISOString();
    if (update.qr) {
      session.status = 'pending';
      session.progress = 'QR Code gerado';
      session.qrCode = await QRCode.toDataURL(update.qr, { margin: 1, width: 360 });
    }
    if (update.connection === 'open') {
      session.status = 'connected';
      session.progress = 'WhatsApp conectado';
      session.qrCode = '';
      session.phone = sock.user?.id ? String(sock.user.id).split(':')[0] : '';
    }
    if (update.connection === 'close') {
      const code = update.lastDisconnect?.error?.output?.statusCode;
      session.status = 'disconnected';
      session.progress = 'WhatsApp desconectado';
      session.error = update.lastDisconnect?.error?.message || '';
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startSession(safeName).catch(err => logger.error(err)), 3000);
      }
    }
  });

  return session;
}

async function sendOne(session, item) {
  const phone = String(item.phone || '').replace(/\D/g, '');
  if (!phone) throw new Error('Telefone vazio');
  const jid = `${phone}@s.whatsapp.net`;
  const exists = await session.sock.onWhatsApp(jid);
  if (!Array.isArray(exists) || !exists[0]?.exists) {
    throw new Error(`Numero nao encontrado no WhatsApp: ${phone}`);
  }
  await session.sock.sendMessage(jid, { text: String(item.message || '') });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'solaire-whatsapp-backend', sessions: sessions.size });
});

app.get('/api/whatsapp/sessions', (_req, res) => {
  res.json({ ok: true, sessions: Array.from(sessions.values()).map(publicSession) });
});

app.post('/api/whatsapp/start', async (req, res) => {
  try {
    const session = await startSession(req.body?.name || 'WhatsApp');
    res.json({ ok: true, sessionId: session.id, session: publicSession(session), message: session.progress });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ ok: false, error: err.message || 'Falha ao iniciar sessao' });
  }
});

app.post('/api/whatsapp/logout/:id', async (req, res) => {
  await stopSession(req.params.id, true);
  res.json({ ok: true });
});

app.delete('/api/whatsapp/session/:id', async (req, res) => {
  await stopSession(req.params.id, true);
  res.json({ ok: true });
});

app.post('/api/whatsapp/send-batch', async (req, res) => {
  const session = sessions.get(String(req.body?.sessionId || ''));
  if (!session || session.status !== 'connected' || !session.sock) {
    return res.status(400).json({ ok: false, error: 'Sessao WhatsApp nao conectada' });
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const delay = Math.max(1000, Number(req.body?.delay || 5000));
  const results = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i++) {
    const item = messages[i] || {};
    try {
      await sendOne(session, item);
      sent++;
      results.push({ index: i, lead: item.name || item.phone, phone: item.phone, success: true });
    } catch (err) {
      failed++;
      results.push({ index: i, lead: item.name || item.phone, phone: item.phone, success: false, error: err.message || 'Falha no envio' });
    }
    if (i < messages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  res.json({ ok: true, total: messages.length, sent, failed, results });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Solaire WhatsApp backend online on :${PORT}`);
});
