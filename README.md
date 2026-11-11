# swingsofia.com

The SWING homepage. Static site, no build step — Vercel deploys every commit to `main` in about 30 seconds.

## Updating the program (the only routine job)

1. Open `program.js` on GitHub and press the pencil (**Edit**).
2. Change `updated` to today's date.
3. Add one line per show, copying an existing line:

   ```js
   { date: "2026-12-05", time: "20:00", act: "Example Band", sub: "Album launch" },
   { date: "2026-12-05", time: "23:00", act: "Example DJ", allAges: true },
   ```

   Two shows on one night = two lines with the same date. `sub` and `allAges` are optional.
4. **Commit changes** (keep "Commit directly to main"). Refresh swingsofia.com after half a minute.

Past dates disappear from the page by themselves. A cancelled gig: delete its line. A changed time: edit the time.

If the page shows a red "program.js has a typo" box, a comma or quote went missing — open the file's **History** on GitHub and restore the previous version, or ask Claude to fix the line.

## Reservations and capacity

`/reserve` takes table bookings. Seats are counted per show: shows starting 19:00–21:00 (small stage) take up to **40** guests online, shows starting 22:00–00:00 (big stage) up to **90**. From 40 % booked the site shows **High interest**; at 100 % the show shows **Tables sold out** and can't be booked online (walk-ins still welcome). A show can have its own limit with `cap: 60` on its line in `program.js`.

Every booking lands in the `#reservations` Discord channel (one message per show, kept current) with a **cancel** link for staff that frees the seats. The bits behind it: `api/reserve.js`, `api/availability.js`, `api/cancel.js`, `lib/capacity.js`; keys in Vercel → Environment Variables (`RESEND_API_KEY`, `DISCORD_WEBHOOK_URL`, the `KV_*` ones from the Upstash store, `ADMIN_KEY`).

## Everything else

- `index.html` — layout, styles, copy in English and Bulgarian, and the script that draws the program. The `CONFIG` block at the top of the script holds the phone number, Google Maps link, and the (currently empty) email, Instagram, Facebook and stage-photo fields: fill a field and the matching link or image appears.
- `assets/` — logo, "Swingin' since '95" script, starburst, instruments, grain, `og.jpg` (link preview), `icon-180.png` (home-screen icon).

The bar menu is a separate site: [swing-menu](https://github.com/swingsofia95/swing-menu) → menu.swingsofia.com.
