// SWING — GET /api/cancel?ref=SW-XXXXXXX&key=ADMIN_KEY
// Staff link (posted with every booking in Discord when ADMIN_KEY is set): marks the booking
// cancelled, frees its seats and refreshes the event's Discord message.
const C = require('../lib/capacity.js');
const { syncEventMessage } = require('./reserve.js');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function page(res, status, title, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(title) + ' — SWING</title>' +
    '<style>body{margin:0;background:#660033;color:#FFFCF1;font:18px/1.5 Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}main{max-width:520px}h1{font-size:34px;margin:0 0 12px;font-style:italic}p{margin:0 0 10px}a{color:#FFFCF1}code{font-family:monospace;font-size:14px;opacity:.8}</style></head>' +
    '<body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>');
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const key = process.env.ADMIN_KEY;
  if (!key || !q.key || q.key !== key) return page(res, 403, 'Not allowed.', '<p>This link needs the staff key.</p>');
  if (!C.hasRedis()) return page(res, 500, 'No store.', '<p>The reservation store is not connected.</p>');
  const ref = String(q.ref || '').trim().toUpperCase();
  if (!/^SW-[A-Z0-9]{5,10}$/.test(ref)) return page(res, 400, 'Which booking?', '<p>The link is missing a valid reference.</p>');

  try {
    const evKey = await C.redis('GET', C.keys.ref(ref));
    if (!evKey) return page(res, 404, 'Not found.', '<p>No booking <code>' + esc(ref) + '</code> — it may be older than 45 days past its night, or was made before cancellations existed.</p>');
    const raw = (await C.redis('LRANGE', C.keys.list(evKey), 0, -1)) || [];
    const idx = raw.findIndex(s => { try { return JSON.parse(s).ref === ref; } catch (e) { return false; } });
    if (idx < 0) return page(res, 404, 'Not found.', '<p>Booking <code>' + esc(ref) + '</code> is not in its night’s list any more.</p>');
    const entry = JSON.parse(raw[idx]);
    const label = entry.label || evKey.replace('|', ' · ');
    if (entry.cancelled) return page(res, 200, 'Already cancelled.', '<p><b>' + esc(entry.name) + '</b> ×' + esc(entry.guests) + ' — ' + esc(label) + '</p><p><code>' + esc(ref) + '</code></p>');

    entry.cancelled = true; entry.cancelledAt = Date.now();
    await C.redis('LSET', C.keys.list(evKey), idx, JSON.stringify(entry));
    const after = Number(await C.redis('DECRBY', C.keys.count(evKey), Number(entry.guests) || 0));
    if (after < 0) await C.redis('SET', C.keys.count(evKey), 0);

    const [night, time] = evKey.split('|');
    const show = await C.findShow(night, time);
    const cap = C.capFor(time, show);
    try { await syncEventMessage({ night, time, label }, evKey, cap); } catch (e) { console.error('discord refresh failed:', e.message); }
    const hook = process.env.DISCORD_WEBHOOK_URL;
    if (hook) await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SWING reservations', content: '❌ Cancelled: **' + entry.name + '** ×' + entry.guests + ' — ' + label + ' `' + ref + '`' }) }).catch(() => {});
    console.log('cancelled', ref, evKey, entry.guests);
    return page(res, 200, 'Cancelled.', '<p><b>' + esc(entry.name) + '</b> ×' + esc(entry.guests) + ' — ' + esc(label) + '</p><p>Seats freed: ' + esc(Math.max(0, after)) + ' / ' + cap + ' now booked.</p><p><code>' + esc(ref) + '</code></p>');
  } catch (e) {
    console.error('cancel failed:', e.message);
    return page(res, 500, 'Something went wrong.', '<p>' + esc(e.message) + '</p>');
  }
};
