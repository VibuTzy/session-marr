// Root stub kept minimal so Vercel/Next detection stays correct.
module.exports = (req, res) => {
  if (res && typeof res.status === 'function') {
    return res.status(200).send('OK');
  }
  return 'OK';
};