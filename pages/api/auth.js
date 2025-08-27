// Wrapper for the handler placed at the repository root (index.js)
// This makes the handler available as a Next.js API route for Vercel
const handler = require('../../index.js');
module.exports = (req, res) => handler(req, res);