// SWING — /api/cancel?ref=SW-XXXXXXX&key=ADMIN_KEY
// Staff link posted with every booking in Discord (when ADMIN_KEY is set).
//   GET  → shows the booking and a "Yes, cancel" button (or "Restore" if already cancelled).
//          Nothing changes on a GET — link previews and crawlers open links, so a visit must be harmless.
//   POST → performs the action (action=cancel | restore), frees or re-takes the seats and
//          refreshes the event's Discord message.
const C = require('../lib/capacity.js');
const { syncEventMessage } = require('./reserve.js');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function page(res, status, title, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (typeof res.status === 'function') res.status(status); else res.statusCode = status;
  res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(title) + ' — SWING</title>' +
    '<style>body{margin:0;background:#660033;color:#FFFCF1;font:18px/1.5 Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}main{max-width:520px}h1{font-size:34px;margin:0 0 12px;font-style:italic}p{margin:0 0 10px}a{color:#FFFCF1}code{font-family:monospace;font-size:14px;opacity:.8}' +
    'form{display:inline-block;margin:14px 10px 0 0}button{cursor:pointer;min-height:48px;padding:0 24px;border-radius:999px;border:2px solid #FFFCF1;background:#FFFCF1;color:#660033;font:700 18px/1 Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase}button.quiet{background:transparent;color:#FFFCF1}button:hover{background:#F63719;border-color:#F63719;color:#FFFCF1}</style></head>' +
    '<body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>');
}

function parseBody(req) {
  let b = req.body;
  if (b && typeof b === 'object') return b;
  const out = {};
  try { new URLSearchParams(String(b || '')).forEach((v, k) => { out[k] = v; }); } catch (e) {}
  return out;
}

async function lookup(ref) {
  const evKey = await C.redis('GET', C.keys.ref(ref));
  if (!evKey) return null;
  const raw = (await C.redis('LRANGE', C.keys.list(evKey), 0, -1)) || [];
  const idx = raw.findIndex(s => { try { return JSON.parse(s).ref === ref; } catch (e) { return false; } });
  if (idx < 0) return null;
  const entry = JSON.parse(raw[idx]);
  return { evKey, idx, entry, label: entry.label || evKey.replace('|', ' · ') };
}

function summary(b) { return '<p><b>' + esc(b.entry.name) + '</b> ×' + esc(b.entry.guests) + ' — ' + esc(b.label) + '<br>' + esc(b.entry.phone || '') + (b.entry.requests ? '<br><i>' + esc(b.entry.requests) + '</i>' : '') + '</p><p><code>' + esc(b.entry.ref) + '</code></p>'; }
function form(action, label, quiet, ref, key) {
  return '<form method="post" action="/api/cancel"><input type="hidden" name="ref" value="' + esc(ref) + '"><input type="hidden" name="key" value="' + esc(key) + '"><input type="hidden" name="action" value="' + action + '"><button type="submit"' + (quiet ? ' class="quiet"' : '') + '>' + label + '</button></form>';
}

module.exports = async (req, res) => {
  if (req.method === 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 200; return res.end(); }
  const src = req.method === 'POST' ? parseBody(req) : (req.query || {});
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || !src.key || src.key !== adminKey) return page(res, 403, 'Not allowed.', '<p>This link needs the staff key.</p>');
  if (!C.hasRedis()) return page(res, 500, 'No store.', '<p>The reservation store is not connected.</p>');
  const ref = String(src.ref || '').trim().toUpperCase();
  if (!/^SW-[A-Z0-9]{5,10}$/.test(ref)) return page(res, 400, 'Which booking?', '<p>The link is missing a valid reference.</p>');

  try {
    const b = await lookup(ref);
    if (!b) return page(res, 404, 'Not found.', '<p>No booking <code>' + esc(ref) + '</code> — it may be older than 45 days past its night.</p>');

    if (req.method !== 'POST') {
      // Just looking: show the booking and the buttons. Nothing changes here.
      if (b.entry.cancelled) return page(res, 200, 'Cancelled booking.', summary(b) + form('restore', 'Restore it', true, ref, src.key));
      return page(res, 200, 'Cancel this booking?', summary(b) + form('cancel', 'Yes, cancel', false, ref, src.key) + '<p style="margin-top:18px;opacity:.75">Or just close this page.</p>');
    }

    const [night, time] = b.evKey.split('|');
    const show = await C.findShow(night, time);
    const cap = C.capFor(time, show);
    const hook = process.env.DISCORD_WEBHOOK_URL;
    const ping = async (content) => { if (hook) await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SWING reservations', content }) }).catch(() => {}); };
    const action = src.action === 'restore' ? 'restore' : 'cancel';

    if (action === 'cancel') {
      if (b.entry.cancelled) return page(res, 200, 'Already cancelled.', summary(b) + form('restore', 'Restore it', true, ref, src.key));
      b.entry.cancelled = true; b.entry.cancelledAt = Date.now();
      await C.redis('LSET', C.keys.list(b.evKey), b.idx, JSON.stringify(b.entry));
      const after = Number(await C.redis('DECRBY', C.keys.count(b.evKey), Number(b.entry.guests) || 0));
      if (after < 0) await C.redis('SET', C.keys.count(b.evKey), 0);
      try { await syncEventMessage({ night, time, label: b.label }, b.evKey, cap); } catch (e) { console.error('discord refresh failed:', e.message); }
      await ping('❌ Cancelled: **' + b.entry.name + '** ×' + b.entry.guests + ' — ' + b.label + ' `' + ref + '`');
      console.log('cancelled', ref, b.evKey, b.entry.guests);
      return page(res, 200, 'Cancelled.', summary(b) + '<p>' + esc(Math.max(0, after)) + ' / ' + cap + ' guests now booked for this show.</p>' + form('restore', 'Undo — restore it', true, ref, src.key));
    }

    // restore
    if (!b.entry.cancelled) return page(res, 200, 'Already active.', summary(b) + form('cancel', 'Cancel it', true, ref, src.key));
    delete b.entry.cancelled; delete b.entry.cancelledAt;
    await C.redis('LSET', C.keys.list(b.evKey), b.idx, JSON.stringify(b.entry));
    const after = Number(await C.redis('INCRBY', C.keys.count(b.evKey), Number(b.entry.guests) || 0));
    try { await syncEventMessage({ night, time, label: b.label }, b.evKey, cap); } catch (e) { console.error('discord refresh failed:', e.message); }
    await ping('↩️ Restored: **' + b.entry.name + '** ×' + b.entry.guests + ' — ' + b.label + ' `' + ref + '`');
    console.log('restored', ref, b.evKey, b.entry.guests);
    return page(res, 200, 'Restored.', summary(b) + '<p>' + esc(after) + ' / ' + cap + ' guests now booked for this show.</p>' + form('cancel', 'Cancel it', true, ref, src.key));
  } catch (e) {
    console.error('cancel failed:', e.message);
    return page(res, 500, 'Something went wrong.', '<p>' + esc(e.message) + '</p>');
  }
};
