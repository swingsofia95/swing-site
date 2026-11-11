// SWING — reservation capacity rules and the small Redis layer behind them.
// Used by api/reserve.js, api/availability.js and api/cancel.js.
// ------------------------------------------------------------
// Capacity per show, by start time:
//   small stage — early shows (19:00–21:00)  → 40 guests
//   big stage   — late shows  (22:00–00:00)  → 90 guests
// A start between the two bands goes to the nearer one (21:30 → big).
// "Another night — just the bar" (no show) counts as the small stage.
// Any show can override this in program.js with  cap: 60  on its line.
// Labels: from 40 % booked → "High interest"; at 100 % → "Tables sold out" (no more online bookings; walk-ins still fine).
// ------------------------------------------------------------

const CAP_SMALL = 40;
const CAP_BIG = 90;
const HIGH_INTEREST = 0.4;            // share of capacity at which the label appears
const SPLIT_MINUTES = 21 * 60 + 30;   // starts at/after 21:30 (or after midnight) are "late"

function minutes(hhmm) { const p = String(hhmm || '').split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }

function capFor(time, show) {
  if (show && Number(show.cap) > 0) return Math.round(Number(show.cap));
  if (!time) return CAP_SMALL;                                   // bar only
  const m = minutes(time);
  return (m >= SPLIT_MINUTES || m < 6 * 60) ? CAP_BIG : CAP_SMALL;
}

function statusFor(guests, cap) {
  if (guests >= cap) return 'sold_out';
  if (guests >= cap * HIGH_INTEREST) return 'high';
  return 'open';
}

function eventKey(night, time) { return night + '|' + (time || ''); }

/* ---------- Redis (Upstash REST) ---------- */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const hasRedis = () => !!(REDIS_URL && REDIS_TOKEN);

async function redis(...cmd) {
  const res = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('redis ' + res.status + ': ' + (j.error || ''));
  return j.result;
}
// Several commands in one round trip: [[cmd...], [cmd...]] → [result, result]
async function pipeline(cmds) {
  const res = await fetch(REDIS_URL + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(j)) throw new Error('redis pipeline ' + res.status);
  return j.map(x => x.result);
}

const keys = {
  list: k => 'resv:' + k,          // RPUSH of booking JSON
  count: k => 'resvcount:' + k,    // INTEGER guests booked (atomic)
  msg: k => 'resvmsg:' + k,        // Discord message id of the living list
  ref: ref => 'resvref:' + ref,    // ref → event key (for cancellations)
  events: 'resv:events'            // SET of event keys that have bookings
};

function ttlFor(night) { return Math.max(7, Math.round((new Date(night + 'T12:00:00Z').getTime() - Date.now()) / 86400000) + 45) * 86400; }

/* ---------- the program, read from the live site (cached a minute) ---------- */
const SITE = process.env.SITE_URL || 'https://www.swingsofia.com';
let programCache = { at: 0, shows: [] };
async function loadProgram() {
  if (Date.now() - programCache.at < 60000) return programCache.shows;
  try {
    const res = await fetch(SITE + '/program.js?t=' + Date.now(), { headers: { 'User-Agent': 'swing-reservations' } });
    const text = await res.text();
    const m = /window\.SWING_PROGRAM\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(text.trim());
    if (!m) throw new Error('unexpected shape');
    const vm = require('vm');
    const data = vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 200 });
    programCache = { at: Date.now(), shows: (data.shows || []).filter(s => s && s.date && s.act) };
  } catch (e) {
    console.error('program.js not readable:', e.message);
    programCache.at = Date.now() - 50000;                        // retry in 10 s, keep old data
  }
  return programCache.shows;
}
async function findShow(night, time) {
  const shows = await loadProgram();
  return shows.find(s => s.date === night && (s.time || '') === (time || '')) || null;
}

/* ---------- availability for a set of event keys ---------- */
async function guestsFor(eventKeys) {
  if (!eventKeys.length || !hasRedis()) return {};
  const counts = await pipeline(eventKeys.map(k => ['GET', keys.count(k)]));
  const out = {};
  eventKeys.forEach((k, i) => { out[k] = Number(counts[i]) || 0; });
  return out;
}

module.exports = { CAP_SMALL, CAP_BIG, HIGH_INTEREST, capFor, statusFor, eventKey, hasRedis, redis, pipeline, keys, ttlFor, loadProgram, findShow, guestsFor, minutes };
