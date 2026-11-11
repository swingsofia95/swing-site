// SWING — live program data
// ------------------------------------------------------------
// This is the ONLY file you need to touch to change the program.
//   • One line per show. Two shows on one night = two lines with the same date.
//   • date:    YYYY-MM-DD        time: HH:MM (24h)
//   • act:     the name as it should appear (Cyrillic is fine)
//   • sub:     optional italic line under the act ("Italian night")
//   • allAges: true adds the ALL AGES badge
//   • cap:     optional, max guests for online reservations on that show (default: 40 for shows starting
//              19:00–21:00 / small stage, 90 for 22:00–00:00 / big stage). Example: cap: 60
//   • Past dates disappear from the site by themselves — delete them or leave them, it doesn't matter.
//   • Change "updated" to today's date when you edit, it shows on the page.
// Keep the commas and quotes as they are — one missing comma and the page shows an error.
// ------------------------------------------------------------

window.SWING_PROGRAM = {
  updated: "2026-11-11",

  shows: [
    { date: "2026-11-06", time: "20:30", act: "Leafy & The Capones", sub: "Italian night" },
    { date: "2026-11-07", time: "20:00", act: "Desi & The Honey Grooves" },
    { date: "2026-11-08", time: "19:00", act: "Wonder Events" },
    { date: "2026-11-12", time: "19:00", act: "Bon-Bon", allAges: true },
    { date: "2026-11-13", time: "20:00", act: "ПЕ ЦА ТА", sub: "Acoustic one man show" },
    { date: "2026-11-13", time: "23:00", act: "Amalia & Dirty Purchase" },
    { date: "2026-11-14", time: "20:00", act: "Zhana Bergendorff" },
    { date: "2026-11-14", time: "23:00", act: "Electric Roxy" },
    { date: "2026-11-18", time: "19:00", act: "Bon-Bon", allAges: true },
    { date: "2026-11-20", time: "20:00", act: "Boli" },
    { date: "2026-11-21", time: "19:00", act: "KRK", allAges: true },
    { date: "2026-11-26", time: "20:00", act: "One Voice Study" },
    { date: "2026-11-27", time: "20:00", act: "Shanti Band" },
    { date: "2026-11-27", time: "23:00", act: "Monolit" },
    { date: "2026-11-28", time: "20:00", act: "The Sticks" },
    { date: "2026-11-28", time: "23:00", act: "Affection Seattle Grunge" },
    { date: "2026-11-29", time: "20:00", act: "AURA Trio" },
    { date: "2026-12-04", time: "23:00", act: "Tornado" }
  ]
};
