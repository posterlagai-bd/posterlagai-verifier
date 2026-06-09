const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// In-memory store of received TrxIDs
// Format: { trxId: { amount, from, timestamp } }
const receivedPayments = {};

// Secret key to protect the SMS endpoint
const SMS_SECRET = process.env.SMS_SECRET || 'posterlagai2026';

// ── RECEIVE SMS FROM PHONE ──
// Your SMS forwarder app hits this endpoint
app.post('/sms', (req, res) => {
  const { secret, from, timestamp } = req.body;
  const smsText = req.body.body || req.body.text || ''; // handles both field names

  if (secret !== SMS_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  console.log('SMS received:', { from, smsText });

  // Parse bKash SMS format:
  // "You have received Tk 70.00 from 01XXXXXXXXX. TrxID AB12CD3456 at 09/06/2026..."
  // Also handles: "Tk70", "BDT 70", etc.
  const amountMatch = smsText.match(/(?:Tk|BDT|৳)\s*(\d+(?:\.\d+)?)/i);
  const trxMatch    = smsText.match(/TrxID\s*([A-Z0-9]+)/i);
  const fromMatch   = smsText.match(/from\s*(01\d{9})/i);

  if (trxMatch) {
    const trxId = trxMatch[1].toUpperCase();
    receivedPayments[trxId] = {
      amount:    amountMatch ? parseFloat(amountMatch[1]) : null,
      from:      fromMatch ? fromMatch[1] : (from || null),
      body:      smsText,
      timestamp: timestamp || Date.now(),
    };
    console.log('Stored TrxID:', trxId, receivedPayments[trxId]);
    return res.json({ ok: true, trxId });
  }

  // Not a bKash payment SMS — ignore
  res.json({ ok: true, ignored: true });
});

// ── VERIFY TrxID FROM WEBSITE ──
app.get('/verify', (req, res) => {
  const trxId    = (req.query.trxid || '').toUpperCase().trim();
  const expected = parseFloat(req.query.amount) || 0;

  if (!trxId) return res.json({ valid: false, reason: 'No TrxID provided' });

  const payment = receivedPayments[trxId];

  if (!payment) {
    return res.json({ valid: false, reason: 'TrxID not found. Please wait a moment and try again.' });
  }

  // Check amount matches (allow ±1 taka tolerance for rounding)
  if (expected > 0 && payment.amount !== null) {
    if (Math.abs(payment.amount - expected) > 1) {
      return res.json({
        valid: false,
        reason: `Amount mismatch. Expected ৳${expected}, received ৳${payment.amount}.`
      });
    }
  }

  // Mark as used so it can't be reused
  delete receivedPayments[trxId];

  res.json({ valid: true, amount: payment.amount, from: payment.from });
});

// ── HEALTH CHECK ──
app.get('/', (req, res) => res.send('Poster Lagai Payment Verifier running ✓'));

// ── KEEP-ALIVE PING ──
// Prevents Render free tier from sleeping after 15 min of inactivity
setInterval(() => {
  fetch('https://posterlagai-verifier.onrender.com').catch(() => {});
}, 10 * 60 * 1000); // every 10 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
