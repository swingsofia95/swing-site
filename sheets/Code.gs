/* SWING reservations — Google Apps Script
   ------------------------------------------------------------
   Lives inside the Google Sheet "SWING reservations" (Extensions → Apps Script) in the
   swing.sofia95@gmail.com account. It does three things:

   1. Receives every booking from swingsofia.com/reserve (the Vercel function POSTs here)
      and adds one row to the tab for that month ("2026-11", "2026-12", …).
   2. Emails the booking to the venue and a copy to the guest, from this Gmail account.
   3. Every 10 minutes checks the program on swingsofia.com and, 2 hours before each
      show, posts that show's reservations to the Discord channel.

   Works either bound to the sheet (Extensions → Apps Script) or as a standalone project made at
   script.google.com — for the standalone case put the sheet's id in CONFIG.sheetId.

   SETUP (once):
   • Fill CONFIG below (webhook URL, a long secret of your choosing, sheetId if standalone).
   • Run setup() from the editor (▶) and allow the permissions it asks for.
   • Deploy → New deployment → type Web app → Execute as: Me → Who has access: Anyone
     → copy the Web app URL into Vercel as SHEET_WEBHOOK_URL (and the secret as SHEET_SECRET).
   ------------------------------------------------------------ */

const CONFIG = {
  sheetId: '',                                 // only for a standalone script (script.google.com): the long id in the sheet's URL
  discordWebhookUrl: '',                       // Discord → channel → Integrations → Webhooks → copy URL
  secret: 'change-me-to-a-long-random-phrase', // same value goes into Vercel as SHEET_SECRET
  siteUrl: 'https://swingsofia.com',
  venueEmail: 'swing.sofia95@gmail.com',       // where bookings are emailed
  sendEmail: true,                             // false = sheet + Discord only
  phone: '089 684 0161',
  hoursBefore: 2,                              // digest timing
  barOnlyDigestAt: '17:00'                     // days with no show: post bar-only bookings at this time
};

const TZ = 'Europe/Sofia';
const HEADERS = ['Received', 'Night', 'Time', 'Act', 'Guests', 'Name', 'Phone', 'Email', 'Requests', 'Ref', 'Lang', 'Status', 'Source'];
const PROPS = PropertiesService.getScriptProperties();

/* ---------- one-time setup ---------- */
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'digest') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('digest').timeBased().everyMinutes(10).create();
  monthSheet(fmt(new Date(), 'yyyy-MM-dd'));
  if (!CONFIG.discordWebhookUrl) Logger.log('Reminder: CONFIG.discordWebhookUrl is empty — the digest and the Discord cards will be skipped until it is set.');
  if (CONFIG.secret === 'change-me-to-a-long-random-phrase') Logger.log('Reminder: change CONFIG.secret, then put the same value into Vercel as SHEET_SECRET.');
  Logger.log('Setup done: digest runs every 10 minutes. Now deploy as a Web app and copy its URL into Vercel as SHEET_WEBHOOK_URL.');
}

/* ---------- web app: receive a booking ---------- */
function doGet() { return out({ ok: true, service: 'SWING reservations' }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out({ ok: false, error: 'json' }); }
  if (!body.secret || body.secret !== CONFIG.secret) return out({ ok: false, error: 'auth' });
  const r = body.reservation || {};
  if (!r.night || !r.name) return out({ ok: false, error: 'fields' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = monthSheet(r.night);
    sheet.appendRow([new Date(), String(r.night), String(r.time || ''), String(r.act || ''), Number(r.guests) || '', String(r.name), String(r.phone || ''),
      String(r.email || ''), String(r.requests || ''), String(r.ref || ''), String(r.lang || 'en'), '', String(r.source || 'web')]);
  } finally { lock.releaseLock(); }

  const result = { ok: true, sheet: true };
  if (CONFIG.sendEmail) {
    try { sendVenueEmail(r); result.email = true; } catch (err) { result.email = false; result.emailError = String(err); }
    if (r.email) { try { sendGuestEmail(r); result.guest = true; } catch (err) { result.guest = false; } }
  }
  return out(result);
}

/* ---------- the 2-hours-before digest ---------- */
function digest() {
  if (!CONFIG.discordWebhookUrl) return;
  const now = new Date();
  const today = fmt(now, 'yyyy-MM-dd');
  const nowMin = Number(fmt(now, 'HH')) * 60 + Number(fmt(now, 'mm'));
  const posted = JSON.parse(PROPS.getProperty('posted') || '{}');
  let changed = false;

  let shows = [];
  try { shows = loadProgram().filter(s => s.date === today).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1); }
  catch (err) { console.error('program.js could not be read: ' + err); }

  const lead = CONFIG.hoursBefore * 60;
  shows.forEach((s, i) => {
    const key = s.date + 'T' + (s.time || '');
    if (posted[key]) return;
    const diff = toMin(s.time || '20:00') - nowMin;
    if (diff < lead - 10 || diff > lead + 10) return;   // a 20-minute window; the trigger runs every 10 minutes
    const rows = rowsFor(s.date).filter(r => r.time === s.time || (i === 0 && !r.time));
    postDiscord(formatDigest(s, rows, i === 0));
    posted[key] = Date.now(); changed = true;
  });

  // Days without a show: bar-only bookings, once, at CONFIG.barOnlyDigestAt.
  if (!shows.length) {
    const key = today + 'T--', at = toMin(CONFIG.barOnlyDigestAt);
    if (!posted[key] && nowMin >= at && nowMin < at + 20) {
      const rows = rowsFor(today);
      if (rows.length) postDiscord(formatDigest({ date: today, time: '', act: '' }, rows, true));
      posted[key] = Date.now(); changed = true;
    }
  }

  // Forget keys older than 3 days.
  const cutoff = Date.now() - 3 * 86400000;
  Object.keys(posted).forEach(k => { if (posted[k] < cutoff) { delete posted[k]; changed = true; } });
  if (changed) PROPS.setProperty('posted', JSON.stringify(posted));
}

/* Posts today's list to Discord right now — run it from the editor (▶) to see how it looks. */
function digestNow() {
  const date = fmt(new Date(), 'yyyy-MM-dd');
  const shows = loadProgram().filter(s => s.date === date).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
  if (!shows.length) shows.push({ date: date, time: '', act: '' });
  shows.forEach((s, i) => postDiscord(formatDigest(s, rowsFor(date).filter(r => r.time === s.time || (i === 0 && !r.time)), i === 0)));
}

function formatDigest(show, rows, includeBarOnly) {
  const d = parseDate(show.date);
  const when = fmt(d, 'EEE d MMM') + (show.time ? ' · ' + show.time : '') + (show.act ? ' · ' + show.act : ' · bar only');
  const guests = rows.reduce((n, r) => n + (Number(r.guests) || 0), 0);
  const head = '📋 **Tonight · ' + when + '**\n' + (rows.length ? rows.length + ' table' + (rows.length === 1 ? '' : 's') + ' · ' + guests + ' guests' : 'No reservations for this one yet.');
  const lines = rows.map(r => '• **' + r.name + '** ×' + r.guests + ' — ' + r.phone +
    (r.requests ? ' — _' + r.requests.replace(/\s+/g, ' ').slice(0, 160) + '_' : '') +
    (!r.time && show.time ? ' — (bar only, no show)' : '') +
    (r.ref ? ' (' + r.ref + ')' : ''));
  return [head].concat(lines).join('\n');
}

/* ---------- helpers ---------- */
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fmt(d, pattern) { return Utilities.formatDate(d, TZ, pattern); }
function parseDate(iso) { const p = String(iso).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0); }
function toMin(hhmm) { const p = String(hhmm).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }

function book() { return CONFIG.sheetId ? SpreadsheetApp.openById(CONFIG.sheetId) : SpreadsheetApp.getActiveSpreadsheet(); }

function monthSheet(night) {
  const name = String(night).slice(0, 7);                           // "2026-11"
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name, 0);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#660033').setFontColor('#FFFCF1');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd.MM.yyyy HH:mm');          // Received
  sh.getRange('B:D').setNumberFormat('@'); sh.getRange('F:K').setNumberFormat('@'); sh.getRange('M:M').setNumberFormat('@'); // keep text as text
  sh.getRange('E:E').setNumberFormat('0');
  const status = sh.getRange('L2:L1000');
  status.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['', 'arrived', 'no-show', 'cancelled'], true).setAllowInvalid(true).build());
  [140, 100, 60, 180, 60, 180, 130, 200, 260, 90, 50, 90, 70].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  return sh;
}

function rowsFor(date) {
  const ss = book();
  const sh = ss.getSheetByName(String(date).slice(0, 7));
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues();
  return values.map(v => ({
    night: cellDate(v[1]), time: cellTime(v[2]), act: String(v[3] || ''), guests: Number(v[4]) || 0, name: String(v[5] || ''),
    phone: String(v[6] || ''), email: String(v[7] || ''), requests: String(v[8] || ''), ref: String(v[9] || ''), status: String(v[11] || '')
  })).filter(r => r.night === date && r.name && r.status !== 'cancelled');
}
function cellDate(v) { return v instanceof Date ? fmt(v, 'yyyy-MM-dd') : String(v || '').slice(0, 10); }
function cellTime(v) {
  if (v instanceof Date) return fmt(v, 'HH:mm');
  if (typeof v === 'number') { const m = Math.round(v * 1440); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  return String(v || '').slice(0, 5);
}

function loadProgram() {
  const res = UrlFetchApp.fetch(CONFIG.siteUrl + '/program.js?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  const m = /window\.SWING_PROGRAM\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(res.getContentText().trim());
  if (!m) throw new Error('program.js has an unexpected shape');
  const data = eval('(' + m[1] + ')');
  return (data.shows || []).filter(s => s && s.date && s.act);
}

function postDiscord(text) {
  if (!CONFIG.discordWebhookUrl) return;
  // Discord takes 2000 characters per message; split long lists on line breaks.
  const chunks = []; let cur = '';
  text.split('\n').forEach(line => { if ((cur + '\n' + line).length > 1900) { chunks.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line; });
  if (cur) chunks.push(cur);
  chunks.forEach(c => UrlFetchApp.fetch(CONFIG.discordWebhookUrl, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ username: 'SWING reservations', content: c })
  }));
}

/* ---------- email ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function sendVenueEmail(r) {
  const rows = [['Night', r.label || r.night], ['Guests', r.guests], ['Name', r.name], ['Phone', r.phone], ['Email', r.email || '—'], ['Requests', r.requests || '—'], ['Ref', r.ref || '']];
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F"><h2 style="margin:0 0 12px;color:#660033">New reservation — ' + esc(r.label || r.night) + ' — ' + esc(r.guests) + ' guests</h2>' +
    '<table style="border-collapse:collapse">' + rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#666">' + k + '</td><td style="padding:4px 0"><b>' + esc(v) + '</b></td></tr>').join('') + '</table>' +
    '<p style="margin-top:16px;color:#666">Full list: the "SWING reservations" sheet, tab ' + esc(String(r.night).slice(0, 7)) + '.</p></div>';
  MailApp.sendEmail({ to: CONFIG.venueEmail, subject: 'Reservation: ' + (r.label || r.night) + ' · ' + r.guests + ' guests · ' + r.name,
    htmlBody: html, body: rows.map(([k, v]) => k + ': ' + v).join('\n'), name: 'SWING reservations', replyTo: r.email || CONFIG.venueEmail });
}

function sendGuestEmail(r) {
  const bg = r.lang === 'bg', when = r.label || r.night;
  const lines = bg
    ? ['Здравей, ' + r.name + '!', 'Записахме маса за ' + r.guests + ' на ' + when + '.', r.requests ? 'Бележка: ' + r.requests : '', 'Ако нещо се промени, обади се на ' + CONFIG.phone + '. Номер на резервацията: ' + (r.ref || '') + '.', 'До скоро — SWING, ' + CONFIG.siteUrl]
    : ['Hi ' + r.name + ',', 'We have you down for a table for ' + r.guests + ' on ' + when + '.', r.requests ? 'Your note: ' + r.requests : '', 'If anything changes, call ' + CONFIG.phone + '. Reservation ref: ' + (r.ref || '') + '.', 'See you there — SWING, ' + CONFIG.siteUrl];
  const text = lines.filter(Boolean).join('\n\n');
  MailApp.sendEmail({ to: r.email, subject: (bg ? 'Масата ти в SWING — ' : 'Your table at SWING — ') + when, body: text,
    htmlBody: '<div style="font:16px/1.5 Arial,sans-serif;color:#1F000F">' + lines.filter(Boolean).map(l => '<p>' + esc(l) + '</p>').join('') + '</div>',
    name: 'SWING', replyTo: CONFIG.venueEmail });
}
