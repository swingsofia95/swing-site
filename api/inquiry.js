// SWING — company / private party inquiries: POST /api/inquiry
// ------------------------------------------------------------
// The form on /private-parties posts here. This validates the request and hands it to:
//   • Resend — an email to the venue inbox (reply goes straight to the person who asked)
//     and a short "we got it" copy to them
//   • the Discord webhook — one card per inquiry, in the same channel as the reservations
// Nothing is stored and no seats are counted: an inquiry is a lead to answer, not a booking.
//
// Uses the same Vercel environment variables as api/reserve.js:
//   RESEND_API_KEY, DISCORD_WEBHOOK_URL, optional RESERVATIONS_TO / RESERVATIONS_FROM,
//   optional INQUIRY_DISCORD_WEBHOOK_URL to send inquiries to a different Discord channel.
// An inquiry counts as received when the venue email or the Discord card went through.
// ------------------------------------------------------------

const TO = process.env.RESERVATIONS_TO || 'swing.sofia95@gmail.com';
const FROM = process.env.RESERVATIONS_FROM || 'SWING <reservations@swingsofia.com>';
const PHONE = '089 684 0161';
const SITE = 'https://swingsofia.com';
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?swingsofia\.com$/;

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

// Very small per-instance rate limit: 5 inquiries per IP per 10 minutes.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 5;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, ' ');

const GUESTS = { 'under-30': 'up to 30', '30-60': '30 - 60', '60-100': '60 - 100', '100-150': '100 - 150', '150-plus': 'over 150' };
const GUESTS_BG = { 'under-30': 'до 30', '30-60': '30 - 60', '60-100': '60 - 100', '100-150': '100 - 150', '150-plus': 'над 150' };
const PROGRAM = { band: 'Live band', dj: 'DJ', acoustic: 'Acoustic set', catering: 'Catering' };

function validate(b) {
  const out = {};
  out.name = oneLine(b.name, 80);
  if (out.name.length < 2) return { error: 'name' };
  out.company = oneLine(b.company, 100);
  if (out.company.length < 2) return { error: 'company' };
  out.email = oneLine(b.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) return { error: 'email' };
  out.phone = oneLine(b.phone, 30);
  if (!/^[+\d][\d\s().-]{5,}$/.test(out.phone)) return { error: 'phone' };
  out.guests = String(b.guests || '');
  if (!GUESTS[out.guests]) return { error: 'guests' };
  out.date = clean(b.date, 10);                          // YYYY-MM-DD or ''
  if (out.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) return { error: 'date' };
    const d = new Date(out.date + 'T12:00:00Z');
    if (isNaN(d) || d.getTime() < Date.now() - 36 * 3600 * 1000) return { error: 'date' };
  }
  out.program = (Array.isArray(b.program) ? b.program : []).map(String).filter((k, i, a) => PROGRAM[k] && a.indexOf(k) === i);
  out.message = clean(b.message, 1500);
  out.source = oneLine(b.source, 160);
  out.lang = b.lang === 'en' ? 'en' : 'bg';
  return { data: out };
}

function ref() { return 'SP-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).toUpperCase().slice(2, 4); }

function prettyDate(iso, lang) {
  if (!iso) return '';
  const p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  return d.toLocaleDateString(lang === 'bg' ? 'bg-BG' : 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function venueEmail(r, id) {
  const when = r.date ? prettyDate(r.date, 'en') : 'no date yet';
  const rows = [
    ['Company', r.company], ['Contact', r.name], ['Email', r.email], ['Phone', r.phone],
    ['Guests', GUESTS[r.guests]], ['Preferred date', when],
    ['Interested in', r.program.map(k => PROGRAM[k]).join(', ') || '—'],
    ['Message', r.message || '—'], ['Campaign', r.source || '—'], ['Ref', id], ['Language', r.lang.toUpperCase()]
  ];
  const text = rows.map(([k, v]) => k + ': ' + v).join('\n');
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F"><h2 style="margin:0 0 12px;color:#660033">Party inquiry — ' + esc(r.company) + ' — ' + esc(GUESTS[r.guests]) + ' guests</h2>' +
    '<table style="border-collapse:collapse">' + rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top;white-space:nowrap">' + k + '</td><td style="padding:4px 0"><b>' + esc(v).replace(/\n/g, '<br>') + '</b></td></tr>').join('') + '</table>' +
    '<p style="margin-top:16px"><a href="mailto:' + esc(r.email) + '">Reply to ' + esc(r.name) + '</a> · <a href="tel:' + esc(r.phone.replace(/[^+\d]/g, '')) + '">Call ' + esc(r.phone) + '</a></p></div>';
  return { from: FROM, to: [TO], reply_to: r.email, subject: 'Party inquiry: ' + r.company + ' · ' + GUESTS[r.guests] + ' guests · ' + when, text, html };
}

function guestEmail(r, id) {
  const bg = r.lang === 'bg';
  const when = r.date ? prettyDate(r.date, r.lang) : '';
  const subject = bg ? 'Получихме запитването ви - SWING' : 'We’ve got your inquiry - SWING';
  const lines = bg ? [
    'Здравейте, ' + r.name + '!',
    'Получихме запитването ви за фирмено парти в SWING' + (when ? ' (' + when + ', ' + GUESTS_BG[r.guests] + ' гости)' : ' (' + GUESTS_BG[r.guests] + ' гости)') + '.',
    'Ще се свържем с вас възможно най-скоро със свободни дати и варианти за програмата.',
    'Ако бързате, обадете се на ' + PHONE + '. Номер на запитването: ' + id + '.',
    'Поздрави - SWING, ' + SITE
  ] : [
    'Hello ' + r.name + ',',
    'We’ve received your inquiry about a company party at SWING' + (when ? ' (' + when + ', ' + GUESTS[r.guests] + ' guests)' : ' (' + GUESTS[r.guests] + ' guests)') + '.',
    'We’ll get back to you as soon as we can with available dates and options for the programme.',
    'If you’re in a hurry, call ' + PHONE + '. Inquiry ref: ' + id + '.',
    'Best - SWING, ' + SITE
  ];
  const text = lines.join('\n\n');
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F">' + lines.map(l => '<p>' + esc(l) + '</p>').join('') + '</div>';
  return { from: FROM, to: [r.email], reply_to: TO, subject, text, html };
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
  const url = process.env.INQUIRY_DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (!url) return null;                                  // not configured: skip quietly
  const when = r.date ? prettyDate(r.date, 'en') : 'no date yet';
  const body = {
    username: 'SWING parties',
    content: '🥂 **Party inquiry** — ' + r.company + ' — **' + GUESTS[r.guests] + '** guests — ' + when,
    allowed_mentions: { parse: [] },
    embeds: [{
      color: 0x660033,
      fields: [
        { name: 'Company', value: r.company, inline: true },
        { name: 'Contact', value: r.name, inline: true },
        { name: 'Phone', value: r.phone, inline: true },
        { name: 'Email', value: r.email, inline: true },
        { name: 'Guests', value: GUESTS[r.guests], inline: true },
        { name: 'Preferred date', value: when, inline: true },
        ...(r.program.length ? [{ name: 'Interested in', value: r.program.map(k => PROGRAM[k]).join(', '), inline: false }] : []),
        ...(r.message ? [{ name: 'Message', value: r.message.slice(0, 1000), inline: false }] : []),
        ...(r.source ? [{ name: 'Campaign', value: r.source, inline: true }] : []),
        { name: 'Ref', value: id, inline: true }
      ],
      footer: { text: 'swingsofia.com/private-parties' }, timestamp: new Date().toISOString()
    }]
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('Discord ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  if (!originOk(req)) return res.status(403).json({ ok: false, error: 'origin' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'body' });

  // Bots: a hidden field that humans never fill, and a form that was submitted in under 3 seconds.
  if (body.website) return res.status(200).json({ ok: true, ref: ref() });
  const elapsed = Number(body.elapsed);
  if (!(elapsed >= 3000 && elapsed < 24 * 3600 * 1000)) return res.status(400).json({ ok: false, error: 'timing' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'rate' });

  const v = validate(body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const r = v.data, id = ref();

  const done = (await Promise.all([
    sendResend(venueEmail(r, id)).then(x => x ? 'email' : null).catch(e => { console.error('inquiry email failed:', e.message); return null; }),
    sendDiscord(r, id).then(x => x ? 'discord' : null).catch(e => { console.error('inquiry discord failed:', e.message); return null; })
  ])).filter(Boolean);

  if (!done.length) {
    const configured = { resend: !!process.env.RESEND_API_KEY, discord: !!(process.env.INQUIRY_DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL) };
    console.error('inquiry NOT delivered', id, 'configured:', JSON.stringify(configured), JSON.stringify(r));
    return res.status(502).json({ ok: false, error: 'delivery', configured });
  }
  // The copy to the person who asked is a courtesy: sent after the venue has the lead, never blocks it.
  const guest = await sendResend(guestEmail(r, id)).then(x => x ? 'guest' : null).catch(e => { console.error('inquiry guest email failed:', e.message); return null; });
  if (guest) done.push(guest);
  console.log('inquiry', id, done.join('+'), r.company, r.guests, r.date || 'no-date', r.source || '-');
  return res.status(200).json({ ok: true, ref: id, via: done });
};
