/* Contact form handler.
 *
 * Runs as a Vercel serverless function at /api/contact. The Resend key lives in
 * the RESEND_API_KEY environment variable and is never committed — it is set in
 * the Vercel dashboard.
 *
 * Talks to Resend over plain HTTP rather than their SDK, so the project needs no
 * dependencies and stays a single HTML file plus this one.
 */

const TO = 'adiswed@gmail.com';
const FROM = 'Swed Technology Site <onboarding@resend.dev>';

// Generous for a real enquiry, tight enough to blunt anyone posting junk.
const LIMITS = { name: 120, organization: 160, email: 200, phone: 40, message: 5000 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Strip CR/LF so nothing submitted can inject extra mail headers.
function oneLine(s) {
  return String(s).replace(/[\r\n]+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const name = oneLine(body.name || '');
  const organization = oneLine(body.organization || '');
  const email = oneLine(body.email || '');
  const phone = oneLine(body.phone || '');
  const message = String(body.message || '').trim();

  // Honeypot. Report success so a bot learns nothing from the response.
  if (body.website) return res.status(200).json({ ok: true });

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    if ((body[field] || '').length > max) {
      return res.status(400).json({ error: `The ${field} field is too long.` });
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Mail is not configured.' });
  }

  const rows = [
    ['Name', name],
    ['Organization', organization || '—'],
    ['Email', email],
    ['Phone', phone || '—']
  ].map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('');

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<h2 style="margin:0 0 16px;font-size:18px">New enquiry from swedtechnology.com</h2>` +
    `<table style="border-collapse:collapse;margin-bottom:20px">${rows}</table>` +
    `<div style="padding:16px;background:#f5f6fb;border-radius:8px;white-space:pre-wrap">${esc(message)}</div>` +
    `</div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        // So hitting Reply in the inbox answers the enquirer, not Resend.
        reply_to: email,
        subject: `Enquiry from ${name}${organization ? ' — ' + organization : ''}`,
        html: html
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Resend rejected the send:', r.status, detail);
      return res.status(502).json({ error: 'Could not send the message.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send failed:', err);
    return res.status(502).json({ error: 'Could not send the message.' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return {}; }
}
