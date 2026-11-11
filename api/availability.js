// SWING — GET /api/availability
// Returns, for every upcoming show in program.js (plus any bar-only night with bookings):
//   { "2026-11-13|20:00": { guests: 18, cap: 40, status: "high", left: 22 }, ... }
// status: open | high (≥ 40 % booked) | sold_out. Used by the homepage and the reserve page
// to show the labels.
const C = require('../lib/capacity.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const shows = await C.loadProgram();
    const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - 36 * 3600 * 1000;
    const upcoming = shows.filter(s => new Date(s.date + 'T12:00:00Z').getTime() >= t0);
    const eventKeys = upcoming.map(s => C.eventKey(s.date, s.time));
    let extra = [];
    if (C.hasRedis()) {
      try { extra = (await C.redis('SMEMBERS', C.keys.events)) || []; } catch (e) { console.error('events set:', e.message); }
    }
    extra.forEach(k => { if (eventKeys.indexOf(k) < 0 && k.split('|')[0] >= new Date(t0).toISOString().slice(0, 10)) eventKeys.push(k); });

    const guests = await C.guestsFor(eventKeys);
    const out = {};
    eventKeys.forEach(k => {
      const [night, time] = k.split('|');
      const show = upcoming.find(s => s.date === night && (s.time || '') === time) || null;
      const cap = C.capFor(time, show), g = guests[k] || 0;
      out[k] = { guests: g, cap, left: Math.max(0, cap - g), status: C.statusFor(g, cap) };
    });
    return res.status(200).json({ ok: true, enforced: C.hasRedis(), events: out });
  } catch (e) {
    console.error('availability failed:', e.message);
    return res.status(200).json({ ok: false, enforced: false, events: {} });
  }
};
