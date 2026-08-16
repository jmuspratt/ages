# Ages — Kids' Ages & Grades PWA

A mobile-first PWA that shows, at a glance, how old a set of kids are and what American K-12 grade they're in — then lets you drag a slider five years in either direction and watch both update.

Installable on iPhone via Safari → Share → Add to Home Screen.

## Why this exists

"How old will she be when he starts high school?" is a question that normally takes a calculator and a scrap of paper. This app answers it by dragging your thumb across the bottom of the screen.

## Architecture

```
┌─────────────────────────────────────────────┐
│  1. Static hosting (rsync to web server)     │
│     - index.html / app.js / style.css        │
│     - sw.js / manifest.json / icons          │
├─────────────────────────────────────────────┤
│  2. PWA frontend (vanilla JS)                │
│     - Roster lives in localStorage, per      │
│       device — no accounts, no backend       │
│     - Service worker caches the whole shell  │
│     - Export/Import moves a list between     │
│       devices by hand                        │
└─────────────────────────────────────────────┘
```

There is no server-side component. Every age and grade is arithmetic done in the browser from two stored numbers, so the app works fully offline and there is nothing to keep running.

This is a deliberate difference from its sibling project `../hours`, which does run a persistent Node process under PM2 — but only to keep a Google Places API key server-side. Ages has no secret to hide and no external data source, so it stays purely static.

## Data model

Each person, held in localStorage:

```json
{
  "id": "ida",
  "name": "Ida",
  "birthdate": "2017-04-02",
  "anchorYear": 2026,
  "anchorGrade": 3,
  "family": "The Smiths"
}
```

Field details:

- `id`: URL-safe slug of the name, generated on add. Suffixed if it collides.
- `birthdate`: `YYYY-MM-DD`. Parsed as a *local* date — `new Date("2017-04-02")` would be read as UTC and land a day early for anyone west of Greenwich.
- `anchorYear` + `anchorGrade`: the heart of the app. Grade isn't derivable from a birthdate — cutoffs vary, kids get held back or skip — so it's captured once, as "in school year X, they were in grade Y", and every other year is arithmetic from there.
- `family`: optional free text. Absent or empty means unassigned; records predating the field simply read as unassigned.

### Families

There is no families list. A family is nothing but the set of distinct `family` strings across the roster, derived on read by `familyNames()` — which is the whole reason a group disappears the moment its last member leaves or is reassigned. There is no cleanup step because there is no record to clean up. Don't promote families to stored entities to add ordering or colours; the auto-delete behaviour is a consequence of them not existing.

`groupedPeople()` returns one group per family, in oldest-member order, followed by a single unnamed group holding anyone unassigned. Each family renders as a titled card; the unnamed remainder renders bare on the page, with no card and no heading, because there's no group to name — the card is what marks a family off, so everyone else reads as "everyone else" without being told.

Every card is titled, including when only one family exists. An earlier version suppressed that heading on the grounds it said nothing new; cards made it say something essential, since an untitled card is just an anonymous box.

Each family renders as a rounded card on the page background, titled with the family's name.

Names join case-insensitively: typing "the smiths" when "The Smiths" exists assigns the existing spelling rather than opening a near-identical second group. Renaming a family means editing each member — acceptable while rosters are one household.

`anchorGrade` is an integer so the arithmetic is trivial: `-1` = Pre-K, `0` = Kindergarten, `1`–`12` = numbered grades. Values outside that range are still meaningful and get rendered as "Not in school yet" or "Graduated" / "N yrs past high school".

### localStorage keys

- `people_dates_data`: the array of people above.

### School years

A school year is named for the September that starts it: the **2026 school year runs September 2026 through August 2027**. One function, `schoolYearOf(date)`, owns this mapping, and grade at any date is:

```
grade = anchorGrade + (schoolYearOf(date) - anchorYear)
```

**Summer is a special case.** Between June and August there is no current grade, so the app reports the one they're rising into — "Rising 4th", "Rising Kindergarten" — which is how people actually talk about kids in July. In those months the year used is the calendar year itself rather than `schoolYearOf`.

## Frontend behavior

### First load

Renders an empty state: "Add the kids you want to track…". If the app isn't running standalone, it also warns that iOS keeps *separate* localStorage for a Safari tab and a home-screen app — so anything typed in the browser won't follow you to the installed icon. That hint disappears once there's a roster, since by then the damage would already be done.

### The list

One row per person, oldest first, written as a sentence with the birthday in smaller grey text beneath:

```
Ida is 10 years old and in 4th grade.
Born April 2, 2017
```

During the summer the grade clause becomes "going into 4th grade". Ages read in whole years, except under two where months still carry meaning ("8 months old", "1 year, 11 months old"). Before a person's birthdate the sentence changes shape entirely: "Theo isn't born for another 3 years."

**The verb tracks the slider.** At today it's "is"; drag forward and every sentence becomes "Ida will be 10 years old and in 4th grade"; drag back and it's "Ida was 4 years old and not in school yet". Grade clauses are deliberately written tense-neutral — "out of high school" rather than "has graduated" — so the verb is the only word that has to change.

Grade clauses outside K-12 — "not in school yet", "out of high school", "5 years past high school" — render in a muted grey, so the in-school kids stay visually dominant. Only that clause is greyed, not the whole sentence, which is why `sentenceFor()` returns the sentence in separately-rendered pieces.

#### Colour and tense

The sentence sits in a medium grey. The name holds full contrast throughout — whose row it is doesn't change with the date — and the two phrases that actually do change, the age and the grade, lift out in 600 weight and a colour that says where the slider is:

| Slider | Age & grade phrases | Light | Dark |
| --- | --- | --- | --- |
| Today | near-black | `#1a1a1a` 15.00:1 | `#e8e8e8` 12.67:1 |
| Ahead | green | `#15703a` 5.31:1 | `#3fb950` 6.11:1 |
| Behind | orange | `#b34700` 4.74:1 | `#d29922` 6.15:1 |
| — | sentence grey | `#666` 4.95:1 | `#9a9a9a` 5.52:1 |

Every value clears WCAG AA (4.5:1 for 15px text), measured rather than estimated — and measured against the **page**, not the card. Family rows sit on a white (or pure black) card where contrast is easy; unassigned rows sit directly on the page, which is the tighter constraint and therefore the one the palette is tuned to. Anything that passes on the page passes on a card by definition. Colour is deliberately redundant: the top bar already states the date and the verb already shifts between "is", "will be" and "was", so nobody depends on hue alone.

The heading in the top bar takes the same colour, so the date you're looking at and the ages it produces read as one statement rather than two.

The tint comes from one `data-tense` attribute written on `<body>` by `paint()`, rebinding a single `--value` property that both the heading and the rows read. It sits on `<body>` because the fixed title bar isn't inside the list. Dragging the slider therefore never restyles anything one by one.

Out-of-range clauses are the exception — they stay `--grade-out` and take no tint, because "out of high school" isn't reporting a moment in time.

### The slider

A single `<input type="range">` pinned to the bottom of the screen, in thumb reach. 121 stops covering ±5 years:

- **Centre (index 60)** is today's actual date.
- **Every other stop** is the 1st of that month. Grade transitions always land on September 1, so month resolution is all the precision the app needs, and it keeps a full decade draggable across a phone-width track.
- A **Today** button appears next to the date whenever the slider is off-centre. There's deliberately no centre snap-detent — it would make ±1 month unreachable.

The active date is stated in full in a heading at the top of the **content area** — "Today is August 16, 2026", or "On September 1, 2027…" once you start dragging. It scrolls with the list rather than being pinned, and takes the tense colour along with the ages below it. The fixed top bar holds only the app's name. Since that heading carries the date, the slider bar itself stays small: just the month and year in muted text.

Dragging only rewrites two text nodes per person; the list DOM is built once and cached in `rowRefs`.

### Manage

The panel is two views that are never on screen at once. It opens on the roster — the list of people, an **Add someone…** button beneath it, then Export/Import and the version — so no empty form greets you. The roster carries the same family headings as the main list, from the same `groupedPeople()`, so what you edit matches what you read; when headings are showing, the family is dropped from each row's detail line rather than being stated twice. Tapping Add, or Edit on a row, swaps the roster out for the form, meaning editing one person never leaves the others visible underneath. `showManageView()` and `openForm(person)` are the only transitions.

It's a view swap rather than a modal: no overlay, no backdrop, no scroll lock. On a phone it reads as a sheet regardless, and it keeps the app free of the layered UI the design rules out. While the form is up, the title bar's Done hides so Cancel and Save are the only ways out.

### Export / Import

The Manage panel has an Export button that dumps the roster as JSON into a textarea, and an Import that reads it back. Since localStorage is the only store and it's per-device *and* per-context on iOS, this is the entire backup and device-transfer story.

## Project structure

```
/
├── app/                    # Frontend (deployed as static site)
│   ├── index.html          # Single page app shell
│   ├── app.js              # All frontend logic
│   ├── style.css           # Styles
│   ├── sw.js               # Service worker
│   ├── manifest.json       # PWA manifest
│   └── icon-*.png          # PWA icons (generated, committed)
├── scripts/
│   ├── start.js            # Local static server for previewing app/
│   ├── deploy.sh           # Bumps SW cache version and rsyncs app/ to server
│   └── make-icons.js       # Regenerates icon-192/512.png from scratch
├── .env                    # Deploy path (not committed)
├── CLAUDE.md
└── README.md
```

## Setup

### Prerequisites

Node.js 18+, for the dev server and icon generator only. The app itself has no dependencies and no build step.

### Configuration

Create a `.env` file in the project root:

```
DEPLOY_PATH=user@server:/var/www/example.com/html
```

### Running locally

```bash
npm run start   # → http://localhost:3000
```

That's the whole setup. Open in Safari on iPhone → Share → Add to Home Screen, tap Manage, and add your kids.

## Day-to-day workflow

### Adding or editing a person

Use **Manage** in the app. No script, no deploy — it only affects that device's list.

### Deploying changes

After editing `app/`:

```bash
npm run deploy
```

Rsyncs `app/` to `DEPLOY_PATH` with `--delete`, and bumps the service worker cache version so installed PWAs pick up the change. Without that bump, a cache-first service worker will happily serve the old app forever.

### Regenerating icons

```bash
npm run icons
```

`scripts/make-icons.js` draws the icon into a raw RGBA buffer and encodes a PNG with Node's built-in `zlib` — no canvas, no sharp, no SVG rasterizer, keeping the zero-dependency promise. Edit the constants at the top of that file to change the design. The output PNGs are committed, so this only needs running when the design changes.
