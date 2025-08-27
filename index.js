/**
 * index.js
 *
 * Improved single-file handler to authenticate a WhatsApp bot using Baileys pairing code,
 * then return a zip of the session folder when the connection opens.
 *
 * Notes:
 * - Designed to be used as an HTTP handler (Next.js API route or any Node server route).
 * - Expects a query parameter `phone` with full phone id (e.g. 628123...-123456@g.us or 628123...).
 * - Uses multi-file auth state so each run writes auth files to the session directory.
 * - Prints pairing code to console and returns a streaming zip after successful connection.
 *
 * Usage:
 * - GET /api/auth?phone=62XXXXXXXXXXX
 *
 * Environment:
 * - NODE_SESSION_PATH (optional) to override session path. Defaults to /tmp/sessions
 * - AUTH_TIMEOUT_MS (optional) authentication timeout in ms. Defaults to 90000 (90s)
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const JSZip = require('jszip');

const DEFAULT_SESSION_PATH = process.env.NODE_SESSION_PATH || '/tmp/sessions';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AUTH_TIMEOUT_MS || '90000', 10);

const config = {
  sessionPath: DEFAULT_SESSION_PATH,
  browser: ['Vercel Auth', 'Chrome', '120.0'],
  authTimeoutMs: DEFAULT_TIMEOUT_MS
};

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
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
    // If folder not found, return empty zip buffer
    if (error.code === 'ENOENT') {
      console.warn(`[WARN] Session folder not found: ${folderPath}`);
      return zip.generateAsync({ type: 'nodebuffer' });
    }
    throw error;
  }
}

function formatPairingCode(code) {
  // group by 4 chars and join with '-'
  try {
    return code.match(/.{1,4}/g).join('-');
  } catch {
    return code;
  }
}

module.exports = async function handler(req, res) {
  // only accept GET to keep it simple; adapt as needed for other methods
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, message: 'Method not allowed, use GET' });
  }

  const phone = (req.query && req.query.phone) || (req.url && new URL(req.url, 'http://localhost').searchParams.get('phone'));
  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Nomor telepon diperlukan. Gunakan format: ?phone=62...'
    });
  }

  try {
    await ensureDir(config.sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: config.browser
    });

    // Persist creds on update
    sock.ev.on('creds.update', saveCreds);

    // Try to request pairing code (if method exists). If not, fallback to listening for qr/pairingCode in connection.update.
    let pairingCode = null;
    try {
      if (typeof sock.requestPairingCode === 'function') {
        const raw = await sock.requestPairingCode(phone);
        // requestPairingCode may give a string or object; try to normalize
        pairingCode = typeof raw === 'string' ? raw : (raw?.code || raw?.pairingCode || '');
      } else {
        // no requestPairingCode function available on this Baileys build
        console.info('[INFO] requestPairingCode not available, will wait for connection.update for QR/pairing info.');
      }
    } catch (err) {
      console.warn('[WARN] requestPairingCode call failed or not supported:', err.message || err);
      // continue and try to capture code via connection.update
    }

    // If we already got a code, format and print it
    if (pairingCode) {
      const formatted = formatPairingCode(pairingCode);
      console.log(`[AUTH] Pairing code for ${phone}: ${formatted}`);
      // We don't return it immediately; response will be session zip after successful connection (same behavior as original)
    } else {
      console.log(`[AUTH] Menunggu pairing code untuk ${phone}. Silakan cek log untuk QR/pairing code.`);
    }

    // Wait for connection open, or fail on timeout/close
    const connectionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Waktu habis. Koneksi tidak terbuka dalam ${config.authTimeoutMs / 1000} detik.`));
      }, config.authTimeoutMs);

      sock.ev.on('connection.update', (update) => {
        // Some Baileys versions provide QR string in update.qr, others may provide pairingCode/pairingInfo
        if (update.qr && !pairingCode) {
          pairingCode = update.qr;
          console.log(`[AUTH] QR/Pairing string tersedia untuk ${phone}: ${formatPairingCode(pairingCode)}`);
          console.log('[INFO] Jika menggunakan Vercel, periksa log untuk melihat kode QR atau pairing code.');
        }

        // Some builds may provide `pairingCode` or `pairing` in update
        if ((update.pairingCode || update.pairing) && !pairingCode) {
          pairingCode = update.pairingCode || update.pairing;
          console.log(`[AUTH] Pairing code tersedia untuk ${phone}: ${formatPairingCode(pairingCode)}`);
        }

        const connection = update.connection;
        if (connection === 'open') {
          clearTimeout(timeout);
          resolve();
        } else if (connection === 'close') {
          // When closed, include reason if possible
          clearTimeout(timeout);
          const reason = update.lastDisconnect && update.lastDisconnect.error && update.lastDisconnect.error.output
            ? JSON.stringify(update.lastDisconnect.error.output)
            : (update.lastDisconnect && update.lastDisconnect.error ? String(update.lastDisconnect.error) : 'closed before open');
          reject(new Error(`Koneksi ditutup sebelum berhasil. Reason: ${reason}`));
        }
      });
    });

    // Wait for open OR timeout/close
    await connectionPromise;

    console.log('[SUCCESS] Koneksi berhasil, membuat file zip sesi...');

    const zipBuffer = await createZipFromFolder(config.sessionPath);

    // Send zip as attachment
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=sessions.zip');
    res.status(200).send(zipBuffer);

    // Give socket a short delay then close to let save complete
    setTimeout(async () => {
      try {
        await sock.logout().catch(() => {});
        sock.end?.();
      } catch (e) {
        // ignore
      }
    }, 1000);

  } catch (error) {
    console.error('[ERROR]', error && error.stack ? error.stack : error);
    // Provide friendly error details but don't leak internals
    return res.status(500).json({
      success: false,
      message: typeof error === 'string' ? error : (error.message || 'Terjadi kesalahan internal.')
    });
  }
};
