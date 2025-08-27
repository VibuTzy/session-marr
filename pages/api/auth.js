// API route wrapper — lazy-require the WA handler so Next build doesn't load heavy deps.
module.exports = async (req, res) => {
  try {
    const handler = require('../../lib/wa/index.js');
    return handler(req, res);
  } catch (err) {
    console.error('[API ERROR] Failed to load WA handler:', err && err.stack ? err.stack : err);
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ success: false, message: 'Failed to initialize handler.' });
    }
    return { success: false, message: 'Failed to initialize handler.' };
  }
};