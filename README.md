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

## Everything else

- `index.html` — layout, styles, copy in English and Bulgarian, and the script that draws the program. The `CONFIG` block at the top of the script holds the phone number, Google Maps link, and the (currently empty) email, Instagram, Facebook and stage-photo fields: fill a field and the matching link or image appears.
- `assets/` — logo, "Swingin' since '95" script, starburst, instruments, grain, `og.jpg` (link preview), `icon-180.png` (home-screen icon).

The bar menu is a separate site: [swing-menu](https://github.com/swingsofia95/swing-menu) → menu.swingsofia.com.
