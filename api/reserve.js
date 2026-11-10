// SWING — table reservations: POST /api/reserve
// ------------------------------------------------------------
// Runs on Vercel as a serverless function. The form on /reserve posts here; this
// validates the request and hands the booking to up to three places, in parallel:
//   • the Google Sheet script (sheets/Code.gs) — adds a row, emails the venue and the
//     guest from the swing.sofia95 Gmail, and feeds the 2-hours-before Discord digest
//   • a Discord webhook — one card per booking, the moment it arrives
//   • Resend — optional, only if you want emails sent from reservations@swingsofia.com
//     instead of the Gmail account (then set CONFIG.sendEmail = false in the sheet script)
//
// Settings live in Vercel → Project → Settings → Environment Variables:
//   SHEET_WEBHOOK_URL     the Apps Script "Web app" URL (see the guide)
//   SHEET_SECRET          the same secret as CONFIG.secret in the script
//   DISCORD_WEBHOOK_URL   from Discord → channel → Integrations → Webhooks
//   RESEND_API_KEY        optional, from resend.com
//   RESERVATIONS_TO       optional, default swing.sofia95@gmail.com (Resend only)
//   RESERVATIONS_FROM     optional, default SWING <reservations@swingsofia.com> (Resend only)
// A booking counts as received when at least one of sheet / email / Discord went through.
// ------------------------------------------------------------

const TO = process.env.RESERVATIONS_TO || 'swing.sofia95@gmail.com';
const FROM = process.env.RESERVATIONS_FROM || 'SWING <reservations@swingsofia.com>';
const PHONE = '089 684 0161';
const SITE = 'https://swingsofia.com';
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?swingsofia\.com$/;
// Accept the live domain, plus whatever host this very deployment is served on
// (preview URLs on vercel.app), plus localhost for tests.
function originOk(req) {
  const origin = req.headers.origin || '';
  if (!origin) return true;
  if (ALLOWED_ORIGINS.test(origin)) return true;
  try {
    const o = new URL(origin);
    if (o.host === req.headers.host) return true;
    if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true;
  } catch (e) {}
  return false;
}

// Very small per-instance rate limit: 6 bookings per IP per 10 minutes.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 6;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function validate(b) {
  const out = {};
  out.name = clean(b.name, 80);
  if (out.name.length < 2) return { error: 'name' };
  out.guests = parseInt(b.guests, 10);
  if (!(out.guests >= 1 && out.guests <= 20)) return { error: 'guests' };
  out.phone = clean(b.phone, 30);
  if (!/^[+\d][\d\s().-]{5,}$/.test(out.phone)) return { error: 'phone' };
  out.email = clean(b.email, 120);
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) return { error: 'email' };
  out.night = clean(b.night, 10);                       // YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.night)) return { error: 'event' };
  const d = new Date(out.night + 'T12:00:00Z');
  if (isNaN(d) || d.getTime() < Date.now() - 36 * 3600 * 1000) return { error: 'event' };
  out.time = clean(b.time, 5);
  if (out.time && !/^\d{2}:\d{2}$/.test(out.time)) out.time = '';
  out.act = clean(b.act, 120);                          // '' when "another night"
  out.label = clean(b.label, 160) || out.night;         // human-readable, as shown in the dropdown
  out.requests = clean(b.requests, 1000);
  out.lang = b.lang === 'bg' ? 'bg' : 'en';
  return { data: out };
}

function ref() { return 'SW-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).toUpperCase().slice(2, 4); }

function venueEmail(r, id) {
  const rows = [
    ['Night', r.label], ['Guests', String(r.guests)], ['Name', r.name], ['Phone', r.phone],
    ['Email', r.email || '—'], ['Requests', r.requests || '—'], ['Ref', id], ['Language', r.lang.toUpperCase()]
  ];
  const text = rows.map(([k, v]) => k + ': ' + v).join('\n');
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F"><h2 style="margin:0 0 12px;color:#660033">New reservation — ' + esc(r.label) + ' — ' + r.guests + ' guests</h2>' +
    '<table style="border-collapse:collapse">' + rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#666">' + k + '</td><td style="padding:4px 0"><b>' + esc(v) + '</b></td></tr>').join('') + '</table>' +
    '<p style="margin-top:16px"><a href="tel:' + esc(r.phone.replace(/[^+\d]/g, '')) + '">Call ' + esc(r.phone) + '</a>' + (r.email ? ' · <a href="mailto:' + esc(r.email) + '">Reply to guest</a>' : '') + '</p></div>';
  return {
    from: FROM, to: [TO], reply_to: r.email || undefined,
    subject: 'Reservation: ' + r.label + ' · ' + r.guests + ' guests · ' + r.name,
    text, html
  };
}

function guestEmail(r, id) {
  const bg = r.lang === 'bg';
  const subject = bg ? 'Масата ти в SWING — ' + r.label : 'Your table at SWING — ' + r.label;
  const lines = bg ? [
    'Здравей, ' + r.name + '!',
    'Записахме маса за ' + r.guests + ' на ' + r.label + '.',
    r.requests ? 'Бележка: ' + r.requests : '',
    'Ако нещо се промени, обади се на ' + PHONE + '. Номер на резервацията: ' + id + '.',
    'До скоро — SWING, ' + SITE
  ] : [
    'Hi ' + r.name + ',',
    'We have you down for a table for ' + r.guests + ' on ' + r.label + '.',
    r.requests ? 'Your note: ' + r.requests : '',
    'If anything changes, call ' + PHONE + '. Reservation ref: ' + id + '.',
    'See you there — SWING, ' + SITE
  ];
  const text = lines.filter(Boolean).join('\n\n');
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F">' + lines.filter(Boolean).map(l => '<p>' + esc(l) + '</p>').join('') + '</div>';
  return { from: FROM, to: [r.email], subject, text, html };
}

async function logToSheet(r, id) {
  const url = process.env.SHEET_WEBHOOK_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) return null;                       // not configured: skip quietly
  const res = await fetch(url, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, reservation: Object.assign({}, r, { ref: id, source: 'web' }) })
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  if (!res.ok || !j || !j.ok) throw new Error('sheet ' + res.status + ': ' + text.slice(0, 200));
  return j;                                               // { ok, sheet, email, guest }
}

async function sendResend(msg) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;                                  // not configured: skip quietly
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(msg)
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function sendDiscord(r, id) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return null;                                  // not configured: skip quietly
  const body = {
    username: 'SWING reservations',
    content: '🎷 **New reservation** — ' + r.label + ' — **' + r.guests + '** guests',
    embeds: [{
      color: 0xF63719,
      fields: [
        { name: 'Name', value: r.name, inline: true },
        { name: 'Phone', value: r.phone, inline: true },
        { name: 'Guests', value: String(r.guests), inline: true },
        { name: 'Night', value: r.label, inline: false },
        { name: 'Email', value: r.email || '—', inline: true },
        { name: 'Ref', value: id, inline: true },
        ...(r.requests ? [{ name: 'Requests', value: r.requests.slice(0, 1000), inline: false }] : [])
      ],
      footer: { text: 'swingsofia.com/reserve' }, timestamp: new Date().toISOString()
    }]
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('Discord ' + res.status + ': ' + (await res.text()).slice(0, 300));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  if (!originOk(req)) return res.status(403).json({ ok: false, error: 'origin' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'body' });

  // Bots: a hidden field that humans never fill, and a form that was submitted in under 3 seconds.
  // The page measures its own elapsed time, so a visitor's wrong clock can't trip this.
  if (body.website) return res.status(200).json({ ok: true, ref: ref() });
  const elapsed = Number(body.elapsed);
  if (!(elapsed >= 3000 && elapsed < 24 * 3600 * 1000)) return res.status(400).json({ ok: false, error: 'timing' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'rate' });

  const v = validate(body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const r = v.data, id = ref();

  const jobs = [
    logToSheet(r, id).then(j => j ? 'sheet' + (j.email ? '+gmail' : '') : null).catch(e => { console.error('sheet failed:', e.message); return null; }),
    sendResend(venueEmail(r, id)).then(x => x ? 'email' : null).catch(e => { console.error('email failed:', e.message); return null; }),
    sendDiscord(r, id).then(x => x === null ? null : 'discord').catch(e => { console.error('discord failed:', e.message); return null; })
  ];
  if (r.email) jobs.push(sendResend(guestEmail(r, id)).then(x => x ? 'guest' : null).catch(e => { console.error('guest email failed:', e.message); return null; }));
  const done = (await Promise.all(jobs)).filter(Boolean);

  if (!done.some(d => d.indexOf('sheet') === 0) && !done.includes('email') && !done.includes('discord')) {
    const configured = { resend: !!process.env.RESEND_API_KEY, discord: !!process.env.DISCORD_WEBHOOK_URL, sheet: !!(process.env.SHEET_WEBHOOK_URL && process.env.SHEET_SECRET) };
    console.error('reservation NOT delivered', id, 'configured:', JSON.stringify(configured), JSON.stringify(r));
    return res.status(502).json({ ok: false, error: 'delivery', configured });
  }
  console.log('reservation', id, done.join('+'), r.label, r.guests, r.name);
  return res.status(200).json({ ok: true, ref: id, via: done });
};
