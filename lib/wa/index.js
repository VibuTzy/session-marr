// Lightweight WA handler with runtime (lazy) requires to avoid breaking Next build phase.
const fs = require('fs').promises;
const path = require('path');
const JSZip = require('jszip');

const DEFAULT_SESSION_PATH = process.env.NODE_SESSION_PATH || '/tmp/sessions';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AUTH_TIMEOUT_MS || '90000', 10);

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}

async function createZipFromFolder(folderPath) {
  const zip = new JSZip();
  try {
    const files = await fs.readdir(folderPath);
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const fileData = await fs.readFile(filePath);
        zip.file(file, fileData);
      }
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // no sessions yet -> return empty zip
      return zip.generateAsync({ type: 'nodebuffer' });
    }
    throw error;
  }
}

function formatPairingCode(code) {
  try { return code.match(/.{1,4}/g).join('-'); } catch { return code; }
}

module.exports = async function handler(req, res) {
  // Lazy-require heavy dependencies here
  const pino = require('pino');
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
  } = require('@whiskeysockets/baileys');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, message: 'Method not allowed, use GET' });
  }

  const phone = (req.query && req.query.phone) || (req.url && new URL(req.url, 'http://localhost').searchParams.get('phone'));
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Nomor telepon diperlukan. Gunakan format: ?phone=62...' });
  }

  try {
    await ensureDir(DEFAULT_SESSION_PATH);

    const { state, saveCreds } = await useMultiFileAuthState(DEFAULT_SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Vercel Auth', 'Chrome', '120.0']
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingCode = null;
    try {
      if (typeof sock.requestPairingCode === 'function') {
        const raw = await sock.requestPairingCode(phone);
        pairingCode = typeof raw === 'string' ? raw : (raw?.code || raw?.pairingCode || '');
      }
    } catch (err) {
      console.warn('[WARN] requestPairingCode failed:', err && err.message ? err.message : err);
    }

    const connectionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Waktu habis. Koneksi tidak terbuka dalam ${DEFAULT_TIMEOUT_MS / 1000} detik.`));
      }, DEFAULT_TIMEOUT_MS);

      sock.ev.on('connection.update', (update) => {
        if (update.qr && !pairingCode) {
          pairingCode = update.qr;
          console.log(`[AUTH] QR/Pairing tersedia untuk ${phone}: ${formatPairingCode(pairingCode)}`);
        }
        if ((update.pairingCode || update.pairing) && !pairingCode) {
          pairingCode = update.pairingCode || update.pairing;
          console.log(`[AUTH] Pairing code tersedia untuk ${phone}: ${formatPairingCode(pairingCode)}`);
        }
        const connection = update.connection;
        if (connection === 'open') { clearTimeout(timeout); resolve(); }
        else if (connection === 'close') {
          clearTimeout(timeout);
          const reason = (update.lastDisconnect && update.lastDisconnect.error) ? JSON.stringify(update.lastDisconnect.error) : 'closed before open';
          reject(new Error(`Koneksi ditutup sebelum berhasil. Reason: ${reason}`));
        }
      });
    });

    await connectionPromise;

    const zipBuffer = await createZipFromFolder(DEFAULT_SESSION_PATH);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=sessions.zip');
    res.status(200).send(zipBuffer);

    // Attempt to logout shortly after sending
    setTimeout(async () => { try { await sock.logout().catch(()=>{}); sock.end?.(); } catch (e) {} }, 1000);

  } catch (error) {
    console.error('[ERROR]', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Terjadi kesalahan internal.' });
  }
};