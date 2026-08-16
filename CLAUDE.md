# CLAUDE.md

Instructions for building the Ages PWA. Read README.md first for full architecture and data model.

## What to build

A single-page PWA that shows a set of kids' ages and American K-12 grade levels in one glance, with a slider to scrub ±5 years. Vanilla HTML/CSS/JS — no frameworks, no build step, no npm dependencies in `app/`. The app must work as a standalone home-screen app on iPhone.

## Implementation priorities

1. **One glance, no interaction required.** Opening the app shows every kid's current age and grade. The slider is the only control that matters; everything else hides behind Manage.
2. **Information density.** This is a utility, not a showcase. Small text, tight rows, no wasted space.
3. **Instant.** localStorage read → render with no loading state, ever. Dragging the slider rewrites cached text nodes, not the list DOM.

## Decisions already made — don't undo these without asking

- **No backend, no PM2.** The sibling project `../hours` runs a Node process under PM2, but only to keep a Google Places API key server-side. Ages has no secret and no external data, so it's purely static. Cross-device sync was explicitly considered and declined in favour of Export/Import. Don't add a server, an API proxy, or a `deploy-api.sh` without checking first.
- **No framework.** Vue was considered and rejected — the app is one list, one slider, and pure date math.
- **Grade is captured, not derived.** Grade level is not a function of birthdate: cutoffs vary by district, and kids get held back or skip. Never try to compute it from the birthday. The user is asked once for "grade in school year X", and everything else is arithmetic. Don't add a "guess from birthdate" shortcut.
- **Monthly slider, no date picker.** The spec explicitly didn't want a traditional date picker. Grade transitions always land on September 1, so month resolution loses nothing.
- **No centre snap-detent on the slider.** A detent wide enough to feel would make ±1 month unreachable. The **Today** button does that job instead.
- **Summer shows "Rising Nth".** June–August has no current grade. Reporting the grade they're rising into matches how people actually speak in July, and avoids the awkward "she's in 3rd" when 3rd ended in June.
- **Families are derived, never stored.** A family is only the set of distinct `person.family` strings, read back by `familyNames()`. That's precisely why an empty group deletes itself — there's no record to delete. Don't add a families array to hang ordering or colours off; it would turn free auto-delete into a cleanup step you have to maintain.
- **Family headings hide when they'd say nothing.** `groupedPeople()` falls back to the flat list unless a heading actually separates people — two families, or one family plus someone unassigned. A single household sees no heading at all — its card already says what the label would. Unassigned people get neither heading nor card; the card is what marks a family off, so the remainder reads as "everyone else" unaided. `headingsVisible()` is deliberately separate from `groupedPeople()`: grouping always keeps a family as its own group so it always gets a card, and only the title is conditional.

## Frontend details

### HTML structure

Single `index.html` with:
- A fixed top bar: the app's name ("The Ages App") and a Manage button
- A date heading in the content area, scrolling with the list rather than pinned
- A scrollable list of people
- A hidden Manage panel, itself two mutually exclusive views
- A fixed bottom bar: the target date and the slider

No hamburger menus, no navbars, no routing.

### The Manage panel's two views

`#manage-view` (roster, Add button, Export/Import, version) and `#person-form` are never on screen together.

The roster carries the same family headings as the main list, from the same `groupedPeople()` — so the list you edit matches the list you read, including the suppression rule for a single household.

It also shares the *styling*, not just the structure: `.family-card`, `.family-heading` and `.family-people` are used unmodified in both places, `#manage-panel`'s gutter matches `#people-list`'s, and `.manage-row` mirrors `.person-row`'s padding while `.manage-name` / `.manage-detail` mirror `.person-name` / `.person-birth`. There are deliberately **no** `#manage-list .family-*` overrides — the two screens drifted apart once already because the card carried its padding in one place and the row carried it in the other. If you restyle a card, restyle it once. When headings are showing, the family is left out of each row's detail line; it would otherwise be stated twice, immediately above the row and again inside it. When they're suppressed, the detail line is the only place an assignment appears, so it goes back in. Opening Manage lands on the roster — the form is not exposed until you tap **Add someone…** — and opening the form hides the roster, so editing one person doesn't leave the others sitting behind it. `showManageView()` and `openForm(person)` are the only two transitions; `openForm()` with no argument means adding.

This is deliberately a view swap and not a modal — no overlay, no backdrop, no z-index, no scroll lock — which is how it satisfies "no modals, drawers, or overlays" while still reading as a sheet on a phone. The title bar's **Done** hides while the form is up, so Cancel and Save are the only exits and there's never a third ambiguous one.

Both views are toggled with the `hidden` attribute, which is why `style.css` carries a global `[hidden] { display: none !important }`. The UA's own `[hidden]` rule loses to any author `display` declaration, and `#person-form` is `display: flex` — without the override, hiding the form silently does nothing. Don't remove it.

### Each list row

A sentence, with the birthday in smaller grey text beneath it:

```
Ida is 10 years old and in 4th grade.
Born April 2, 2017
```

Rules:
- Ages read in whole years ("10 years old"). Under one, months alone ("8 months old"); through age one, both ("1 year, 11 months old"). Above two, months are dropped — the sentence reads better without them.
- Before a person's birthdate the sentence changes shape: "Theo isn't born for another 3 years."
- Grade clauses are lowercase and mid-sentence: "in 4th grade", "in kindergarten", "in pre-K". `gradeNoun()` produces these; `gradeName()` is the title-case version and is only for the Manage panel and the grade picker.
- During June–August the clause becomes "going into 4th grade" — there is no current grade in the summer.
- Clauses outside K-12 get the `.out-of-range` class and render muted grey: "not in school yet", "out of high school", "3 years past high school".
- The verb shifts with the slider: "is" at today, "will be" ahead, "was" behind. Every grade clause is written **tense-neutral** so only that one verb has to change — which is why it's "out of high school" and not "has graduated". Keep new clauses tense-neutral too.

`sentenceFor()` deliberately returns the sentence in five pieces, because they render into separate spans: `lead` (the verb), `value` (the age phrase), `join` (" and "), `gradeLead` ("in " / "going into ") and `gradeValue` (the grade itself). The trailing period is a static text node in the markup. Keep that split if you touch this — it's what lets the grade clause grey out on its own without dimming the whole sentence, and what lets the two value phrases take a colour the connecting words don't.

### Colour-coding the slider's tense

The sentence body is a medium grey. The two value phrases — the age and the grade — lift out of it in **600 weight** and in a colour that reports where the slider is: near-black at today, green ahead, orange behind. Colour is redundant here, never the only signal; the heading already says the date, the verb already shifts tense, and the weight already separates the facts from the connecting words, so hue reads as reinforcement rather than the sole carrier of meaning.

The **name** is the exception in the other direction: it holds `--text` at full contrast no matter where the slider is, because whose row this is doesn't change with the date. So each row is name + two bold facts, joined by grey connective tissue.

`#date-heading` takes the same tint, so "On September 1, 2027…" is the same green as the ages underneath it and the screen reads as one statement about one moment. It lives in the content area, not the title bar, so it's measured against `--bg` like everything else in the list. The title bar holds only the app's name, in `--text`, deliberately untinted — it isn't reporting a moment.

The tint resolves from a single `data-tense` attribute that `paint()` writes on `<body>`, with three `body[data-tense="…"]` rules rebinding one `--value` custom property that both `#app-title` and `.person-value` read. It has to be `<body>` and not `#people-list`, because the fixed title bar is a sibling of the list, not inside it. That's deliberate: scrubbing the slider must not restyle rows individually, so a drag stays one attribute write plus the cached text nodes.

Out-of-range grade clauses keep `--grade-out` and are **not** tinted — `.person-value.out-of-range` outranks `.person-value`. They aren't reporting a moment in time, so giving them a tense colour would say something untrue.

Every colour is chosen against its background for WCAG AA at 15px (4.5:1), in both schemes, and the measured ratio is written beside each custom property in `style.css`. If you change one, re-measure it; don't eyeball a replacement. Note `--grade-out` itself predates this and sits below AA (2.85:1 light, 3.89:1 dark) — deliberate de-emphasis, but worth knowing it's a gap.

### Grade arithmetic

All of it hangs off `schoolYearOf(date)`, which names a school year for the September that starts it. Grade is `anchorGrade + (schoolYearOf(date) - anchorYear)`, with the summer months substituting the calendar year. `anchorGrade` is an integer: `-1` Pre-K, `0` Kindergarten, `1`–`12` numbered. Keep it that way — the integer encoding is what makes every other grade a single addition.

Parse `YYYY-MM-DD` with `parseDate()`, never `new Date(str)` — the latter is read as UTC and lands a day early west of Greenwich.

### Slider

`<input type="range" min="0" max="120">`. Index 60 is today's real date; every other index is the 1st of that month, `RANGE_MONTHS` in each direction.

The **top bar** carries the active date in full: "Today is August 16, 2026" at centre, "On September 1, 2027…" anywhere else. Because that heading already states the date, the bottom bar stays deliberately small — just the month and year in muted 12px text, plus a **Today** pill that appears only when off-centre. Don't reintroduce a large date heading or a "3 months from now" relative label down there; both were removed as redundant.

`paint(date)` is the single entry point for everything that changes as the slider moves — heading, bar label, Today button, and all the sentences.

### Offline behavior

The service worker cache-firsts the entire app shell. There are no dynamic requests to exclude — unlike `../hours`, there's no `/api/` branch to write. Data lives in localStorage, not a cached file, so the app is fully functional offline.

### PWA manifest

`display: standalone` so it looks native. Icons are generated by `scripts/make-icons.js` (raw RGBA + Node's `zlib`, no image dependencies) and committed.

### CSS approach

- System font stack: `-apple-system, BlinkMacSystemFont, sans-serif`
- All colors, font sizes, and spacing as `:root` custom properties, with a `prefers-color-scheme: dark` block that redefines only the colors
- Form inputs must be `--font-size-zoom-safe` (16px) or iOS zooms the viewport on focus
- Safe area insets on both fixed bars: `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`
- Cards, not rules. `--bg` is the page, `--card` the surface a family sits on (white in light, pure black in dark). There are no horizontal rules anywhere in either list — the card edge does that work, and unassigned rows need no separator at all. A gutter on `#people-list` replaced the old edge-to-edge treatment; rows inside a card and bare rows outside one are padded to the same text inset so the left edge never jogs.
- Contrast is measured against `--bg`, not `--card`. Ungrouped rows sit directly on the page, which is the tighter of the two surfaces, so tuning to it means everything passes on a card for free. This is why `--value-future` and `--value-past` are darker than a pure white background alone would require.
- No visible scrollbars

### Storage

`people_dates_data` in localStorage is the only key. `loadPeople()` must never throw on corrupt JSON — return `[]`.

Warn about iOS's split localStorage (Safari tab vs. installed app) **only** while the roster is empty, via `isStandalone()`. Once there are people saved, the warning is too late to help and just adds noise.

## Deploying

`npm run deploy` rewrites two constants in place before rsyncing:

- `CACHE` in `app/sw.js`, to a fresh timestamp. If you change how that constant is written, update the `sed` in `scripts/deploy.sh` to match — a cache-first service worker with a stale version serves the old app forever.
- `VERSION` in `app/app.js`, from `package.json`. Only `app/` is deployed, so `package.json` never reaches the device and the constant is the only copy the app can show. Bumping `package.json` is enough; deploy propagates it. The `sed` matches `const VERSION = "…"` with double quotes, so keep that shape.

## Things to avoid

- No frameworks (React, Vue, Svelte, etc.)
- No build tools (Webpack, Vite, etc.)
- No CSS frameworks (Tailwind, Bootstrap)
- No runtime dependencies in `app/` — it ships as-is
- No icon libraries — text only
- No skeleton loaders or loading spinners
- No modals, drawers, or overlays
- No animations
- No analytics or tracking
- No accounts, no login, no server
