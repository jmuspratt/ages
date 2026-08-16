// Mirrors package.json, which isn't part of the deployed app/ directory — so
// this constant is the only copy that reaches the device. scripts/deploy.sh
// rewrites this line from package.json on every deploy; keep the shape it seds.
const VERSION = "1.0.1";

const STORAGE_KEY = "people_dates_data";
const RANGE_MONTHS = 60; // slider reaches 5 years in each direction
const CENTER = RANGE_MONTHS; // slider index that means "today"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

// Grade is stored as an integer so every other grade is arithmetic:
// -1 = Pre-K, 0 = Kindergarten, 1..12 = numbered grades, 13+ = past high school.
const PRE_K = -1;
const KINDERGARTEN = 0;
const LAST_GRADE = 12;

// Sentinel value for the family picker's "New family…" option, which reveals a
// text field rather than selecting anything.
const NEW_FAMILY = "__new__";

let people = loadPeople();
let sliderValue = CENTER;
let editingId = null;

// iOS (and most browsers) keep separate localStorage for a plain browser tab
// vs. an "Add to Home Screen" app at the same URL — so a roster typed into
// Safari won't be there once the home-screen icon is added and opened.
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// --- Date helpers ---

// Parse "YYYY-MM-DD" as a local date. `new Date(str)` would read it as UTC and
// land on the previous day for anyone west of Greenwich.
function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatLongDate(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatShortDate(date) {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Calendar difference, in whole years and leftover months, from `from` to `to`.
// Negative if `to` precedes `from`.
function diffYearsMonths(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months -= 1;
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return { years, months };
}

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// --- School-year helpers ---

// A school year is named for the September that starts it: the 2026 school
// year runs September 2026 through August 2027. Everything about grades hangs
// off this one mapping.
function schoolYearOf(date) {
  return date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
}

function schoolYearLabel(year) {
  return `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
}

// The school year it's most natural to be asked about right now: the one in
// progress, or — once school is out in June — the one about to start.
function defaultAnchorYear() {
  const now = new Date();
  return now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
}

function isSummer(date) {
  const m = date.getMonth();
  return m >= 5 && m <= 7; // June, July, August
}

function ordinal(n) {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

// Title case, for the Manage panel and the grade picker.
function gradeName(grade) {
  if (grade === PRE_K) return "Pre-K";
  if (grade === KINDERGARTEN) return "Kindergarten";
  if (grade >= 1 && grade <= LAST_GRADE) return `${ordinal(grade)} Grade`;
  return null;
}

// Lowercase, for use mid-sentence in the list.
function gradeNoun(grade) {
  if (grade === PRE_K) return "pre-K";
  if (grade === KINDERGARTEN) return "kindergarten";
  return `${ordinal(grade)} grade`;
}

// The clause that follows "and" in a person's sentence. During the summer
// there is no current grade, so we report the one they're going into — which
// is how people actually talk about kids in July.
function gradeClauseFor(person, date) {
  const summer = isSummer(date);
  const year = summer ? date.getFullYear() : schoolYearOf(date);
  const grade = person.anchorGrade + (year - person.anchorYear);

  // Split at the tint boundary: `lead` stays in the sentence grey, `value`
  // takes the tense colour. An out-of-range clause names no grade, so the whole
  // phrase rides in `value` and is muted by its own class instead.
  if (grade < PRE_K) {
    return { lead: "", value: "not in school yet", outOfRange: true };
  }
  // "out of high school" rather than "has graduated" so the clause carries no
  // tense of its own — only the "be" verb ahead of it changes with the slider.
  if (grade === LAST_GRADE + 1) {
    return { lead: "", value: "out of high school", outOfRange: true };
  }
  if (grade > LAST_GRADE + 1) {
    return {
      lead: "",
      value: `${pluralize(grade - LAST_GRADE, "year")} past high school`,
      outOfRange: true,
    };
  }

  return {
    lead: summer ? "going into " : "in ",
    value: gradeNoun(grade),
    outOfRange: false,
  };
}

// "10 years old", or months alone under one — nobody says "0 years old".
// Months stay attached through age one, where they still carry real meaning.
function agePhrase(years, months) {
  if (years === 0) return `${pluralize(months, "month")} old`;
  if (years === 1 && months > 0) {
    return `1 year, ${pluralize(months, "month")} old`;
  }
  return `${pluralize(years, "year")} old`;
}

// Every grade clause is written tense-neutral, so shifting the whole sentence
// through time is just a matter of swapping the verb ahead of it.
const BE_VERB = { present: "is", past: "was", future: "will be" };
const UNBORN_VERB = {
  present: "isn't born for another",
  past: "wouldn't be born for another",
  future: "won't be born for another",
};

function tenseFor(date) {
  const today = startOfToday();
  if (date.getTime() === today.getTime()) return "present";
  return date > today ? "future" : "past";
}

// Splits into the five spans the row renders. `value` and `gradeValue` are the
// phrases that take the tense colour; `lead`, `join` and `gradeLead` are the
// connecting words that stay in the sentence grey, which is the only reason the
// verb can be tinted differently from the age it introduces. It also keeps the
// grade half muteable on its own when it falls outside K-12. The trailing
// period is static markup.
function sentenceFor(person, date, tense) {
  const birth = parseDate(person.birthdate);

  if (date < birth) {
    const { years, months } = diffYearsMonths(date, birth);
    const parts = [];
    if (years > 0) parts.push(pluralize(years, "year"));
    if (months > 0 || years === 0) parts.push(pluralize(months, "month"));
    return {
      lead: ` ${UNBORN_VERB[tense]} `,
      value: parts.join(", "),
      join: "",
      gradeLead: "",
      gradeValue: "",
      outOfRange: true,
    };
  }

  const { years, months } = diffYearsMonths(birth, date);
  const grade = gradeClauseFor(person, date);
  return {
    lead: ` ${BE_VERB[tense]} `,
    value: agePhrase(years, months),
    join: " and ",
    gradeLead: grade.lead,
    gradeValue: grade.value,
    outOfRange: grade.outOfRange,
  };
}

function headingFor(date, tense) {
  return tense === "present"
    ? `Today is ${formatLongDate(date)}`
    : `On ${formatLongDate(date)}…`;
}

// --- Slider ---

// Index 0..120 maps to a month offset of -60..+60 from the current month.
// The exact centre is today's real date; every other stop is the 1st, which
// is all the resolution grade transitions (always September 1) need.
function dateForSlider(value) {
  const today = startOfToday();
  if (value === CENTER) return today;
  const offset = value - CENTER;
  return new Date(today.getFullYear(), today.getMonth() + offset, 1);
}

// --- Storage ---

function loadPeople() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePeople() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
}

// Oldest first, so a family list reads top-down the way people picture it.
function sortedPeople() {
  return [...people].sort((a, b) => a.birthdate.localeCompare(b.birthdate));
}

// --- Families ---

// Families are derived from the people themselves rather than kept as records
// of their own. That's what makes "delete when empty" free: a name nobody is
// assigned to simply stops being returned, with nothing to clean up.
function familyOf(person) {
  return (person.family || "").trim();
}

// Distinct names, ordered by their oldest member, so groups fall down the page
// in the same order the ungrouped roster would.
function familyNames() {
  const names = [];
  for (const person of sortedPeople()) {
    const family = familyOf(person);
    if (family && !names.includes(family)) names.push(family);
  }
  return names;
}

// Each family is a group, in oldest-member order. Anyone unassigned trails them
// in a single nameless group, which renders bare — no heading, no card. The
// card is what separates a family from the rest now, so the remainder needs no
// label of its own to be legible as "everyone else".
function groupedPeople() {
  const sorted = sortedPeople();
  const loose = sorted.filter((person) => !familyOf(person));

  const groups = familyNames().map((name) => ({
    name,
    people: sorted.filter((person) => familyOf(person) === name),
  }));
  if (loose.length > 0) groups.push({ name: "", people: loose });
  return groups;
}

// Every family card is titled. There used to be a rule suppressing the heading
// for a lone family — back when a heading sat loose above a flat list and would
// have been the only thing there. A card needs its name regardless: an untitled
// one just leaves you working out whose it is.

// --- Elements ---

const el = (id) => document.getElementById(id);

const peopleList = el("people-list");
const onboarding = el("onboarding");
const managePanel = el("manage-panel");
const manageView = el("manage-view");
const manageList = el("manage-list");
const manageBtn = el("manage-btn");
const manageCancelBtn = el("manage-cancel-btn");
const timeBar = el("time-bar");
const slider = el("time-slider");
const dateHeading = el("date-heading");
const dateLabel = el("date-label");
const todayBtn = el("today-btn");
const form = el("person-form");
const formHeading = el("form-heading");
const formCancelBtn = el("form-cancel-btn");
const nameInput = el("person-name");
const birthdateInput = el("person-birthdate");
const anchorYearSelect = el("person-anchor-year");
const gradeSelect = el("person-grade");
const familySelect = el("person-family");
const familyNewInput = el("person-family-new");
const backupText = el("backup-text");

// Cached per-row nodes, so dragging the slider only rewrites two text nodes
// per person instead of rebuilding the list on every input event.
let rowRefs = [];

// --- Rendering ---

function buildList() {
  peopleList.innerHTML = "";
  rowRefs = [];

  for (const group of groupedPeople()) {
    // A named family gets a titled card; the nameless remainder sits bare on
    // the page. Rows nest in their own <ul> so an <li> never contains another.
    let container = peopleList;
    if (group.name) {
      const card = document.createElement("li");
      card.className = "family-card";
      const heading = document.createElement("div");
      heading.className = "family-heading";
      heading.textContent = group.name;
      card.append(heading);
      const inner = document.createElement("ul");
      inner.className = "family-people";
      card.append(inner);
      peopleList.append(card);
      container = inner;
    }

    for (const person of group.people) {
      const li = document.createElement("li");
      li.className = "person-row";

      const sentence = document.createElement("p");
      sentence.className = "person-sentence";
      const name = document.createElement("span");
      name.className = "person-name";
      name.textContent = person.name;
      const lead = document.createElement("span");
      const value = document.createElement("span");
      value.className = "person-value";
      const join = document.createElement("span");
      const gradeLead = document.createElement("span");
      const gradeValue = document.createElement("span");
      gradeValue.className = "person-value";
      sentence.append(
        name,
        lead,
        value,
        join,
        gradeLead,
        gradeValue,
        document.createTextNode("."),
      );

      const birth = document.createElement("p");
      birth.className = "person-birth";
      birth.textContent = `Born ${formatLongDate(parseDate(person.birthdate))}`;

      li.append(sentence, birth);
      container.append(li);
      rowRefs.push({ person, lead, value, join, gradeLead, gradeValue });
    }
  }
}

function updateValues(date, tense) {
  for (const row of rowRefs) {
    const parts = sentenceFor(row.person, date, tense);
    row.lead.textContent = parts.lead;
    row.value.textContent = parts.value;
    row.join.textContent = parts.join;
    row.gradeLead.textContent = parts.gradeLead;
    row.gradeValue.textContent = parts.gradeValue;
    row.gradeValue.classList.toggle("out-of-range", parts.outOfRange);
  }
}

// Everything that changes as the slider moves. The header carries the full
// active date, so the bar above the slider only needs the month and year.
function paint(date) {
  const tense = tenseFor(date);
  dateHeading.textContent = headingFor(date, tense);
  // The heading and every row's tint both resolve from this one attribute, so
  // scrubbing the slider still touches only text nodes plus a single dataset
  // write. It lives on <body> because the title bar is outside the list.
  document.body.dataset.tense = tense;
  dateLabel.textContent =
    tense === "present"
      ? "Today"
      : `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  todayBtn.hidden = tense === "present";
  updateValues(date, tense);
}

function render() {
  const hasPeople = people.length > 0;
  const managing = !managePanel.hidden;

  onboarding.hidden = hasPeople || managing;
  // The heading describes the list, so it goes wherever the list goes.
  dateHeading.hidden = managing || !hasPeople;
  peopleList.hidden = managing;
  timeBar.hidden = managing || !hasPeople;

  if (!managing) {
    const date = dateForSlider(sliderValue);
    buildList();
    paint(date);
  }
}

// --- Manage panel ---

function populateSelects() {
  const base = defaultAnchorYear();
  anchorYearSelect.innerHTML = "";
  // Back one year for a grade already completed, forward enough that a
  // newborn can still be anchored to the September they'll actually start.
  for (let y = base - 1; y <= base + 6; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = schoolYearLabel(y);
    anchorYearSelect.append(opt);
  }
  anchorYearSelect.value = String(base);

  gradeSelect.innerHTML = "";
  for (let g = PRE_K; g <= LAST_GRADE; g++) {
    const opt = document.createElement("option");
    opt.value = String(g);
    opt.textContent = gradeName(g);
    gradeSelect.append(opt);
  }
  gradeSelect.value = String(KINDERGARTEN);

  populateFamilySelect("");
}

// Rebuilt from the roster on every call, so a family that just lost its last
// member is absent from the picker as well as from the list.
function populateFamilySelect(selected) {
  familySelect.innerHTML = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No family";
  familySelect.append(none);

  for (const name of familyNames()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    familySelect.append(opt);
  }

  const create = document.createElement("option");
  create.value = NEW_FAMILY;
  create.textContent = "New family…";
  familySelect.append(create);

  familySelect.value = selected;
  syncFamilyInput();
}

// The free-text field exists only while "New family…" is the selection.
function syncFamilyInput() {
  const creating = familySelect.value === NEW_FAMILY;
  familyNewInput.hidden = !creating;
  if (!creating) familyNewInput.value = "";
}

// Keeps the current choice across a roster change, unless it was a family that
// just disappeared along with its last member.
function refreshFamilySelect() {
  const current = familySelect.value;
  const keep =
    current === NEW_FAMILY || familyNames().includes(current) ? current : "";
  populateFamilySelect(keep);
}

// Typing a name that already exists in another case joins that family instead
// of standing up a near-identical second one beside it.
function chosenFamily() {
  const raw =
    familySelect.value === NEW_FAMILY
      ? familyNewInput.value
      : familySelect.value;
  const family = raw.trim();
  if (!family) return "";
  const existing = familyNames().find(
    (name) => name.toLowerCase() === family.toLowerCase(),
  );
  return existing || family;
}

// Manage is two mutually exclusive views: the roster, and the add/edit form.
// Only ever one on screen — so opening Manage doesn't present an empty form,
// and editing one person doesn't leave the others sitting underneath.

function showManageView() {
  editingId = null;
  form.hidden = true;
  manageView.hidden = false;
  manageCancelBtn.hidden = false;
  buildManageList();
}

// `person` omitted means adding.
function openForm(person) {
  form.reset();
  populateSelects();

  if (person) {
    editingId = person.id;
    nameInput.value = person.name;
    birthdateInput.value = person.birthdate;
    // An anchor year outside the default window (an old record, or someone
    // entered far in advance) still has to be selectable.
    if (
      !anchorYearSelect.querySelector(`option[value="${person.anchorYear}"]`)
    ) {
      const opt = document.createElement("option");
      opt.value = String(person.anchorYear);
      opt.textContent = schoolYearLabel(person.anchorYear);
      anchorYearSelect.prepend(opt);
    }
    anchorYearSelect.value = String(person.anchorYear);
    gradeSelect.value = String(person.anchorGrade);
    populateFamilySelect(familyOf(person));
    formHeading.textContent = `Edit ${person.name}`;
  } else {
    editingId = null;
    formHeading.textContent = "Add someone";
  }

  manageView.hidden = true;
  backupText.hidden = true;
  form.hidden = false;
  // Cancel and Save are the only ways out while the form is up, so the title
  // bar's Done would just be a third, ambiguous exit.
  manageCancelBtn.hidden = true;
  nameInput.focus();
}

function buildManageList() {
  manageList.innerHTML = "";
  // Same grouping as the main list, so the roster you edit matches the one you
  // read — same titled cards, same order, same styling.
  for (const group of groupedPeople()) {
    let container = manageList;
    if (group.name) {
      const card = document.createElement("li");
      card.className = "family-card";
      const heading = document.createElement("div");
      heading.className = "family-heading";
      heading.textContent = group.name;
      card.append(heading);
      const inner = document.createElement("ul");
      inner.className = "family-people";
      card.append(inner);
      manageList.append(card);
      container = inner;
    }

    for (const person of group.people) {
      const li = document.createElement("li");
      li.className = "manage-row";

      const info = document.createElement("div");
      info.className = "manage-info";
      const name = document.createElement("div");
      name.className = "manage-name";
      name.textContent = person.name;
      const detail = document.createElement("div");
      detail.className = "manage-detail";
      const bits = [
        formatShortDate(parseDate(person.birthdate)),
        `${gradeName(person.anchorGrade)} in ${schoolYearLabel(person.anchorYear)}`,
      ];
      // The card's heading always carries the family now, so repeating it in
      // the row would just state it twice.
      detail.textContent = bits.join(" · ");
      info.append(name, detail);

      const actions = document.createElement("div");
      actions.className = "manage-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openForm(person));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        if (!confirm(`Remove ${person.name}?`)) return;
        people = people.filter((p) => p.id !== person.id);
        savePeople();
        // They may have been the last member of their family, and the picker is
        // rebuilt from the roster.
        refreshFamilySelect();
        buildManageList();
      });
      actions.append(editBtn, removeBtn);

      li.append(info, actions);
      container.append(li);
    }
  }
}

function openManage() {
  managePanel.hidden = false;
  manageBtn.hidden = true;
  showManageView();
  render();
}

function closeManage() {
  managePanel.hidden = true;
  manageBtn.hidden = false;
  manageCancelBtn.hidden = true;
  form.hidden = true;
  backupText.hidden = true;
  editingId = null;
  render();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name || !birthdateInput.value) return;

  const record = {
    name,
    birthdate: birthdateInput.value,
    anchorYear: Number(anchorYearSelect.value),
    anchorGrade: Number(gradeSelect.value),
    family: chosenFamily(),
  };

  if (editingId) {
    people = people.map((p) => (p.id === editingId ? { ...p, ...record } : p));
  } else {
    // Slug collisions are possible (two kids named Sam), so disambiguate.
    let id = slugify(name) || "person";
    while (people.some((p) => p.id === id)) id = `${id}-${people.length + 1}`;
    people.push({ id, ...record });
  }

  savePeople();
  // Saving returns you to the roster rather than leaving a stale form up.
  showManageView();
});

familySelect.addEventListener("change", () => {
  syncFamilyInput();
  if (!familyNewInput.hidden) familyNewInput.focus();
});

formCancelBtn.addEventListener("click", showManageView);
manageBtn.addEventListener("click", openManage);
manageCancelBtn.addEventListener("click", closeManage);
el("add-person-btn").addEventListener("click", () => openForm());

// From the empty state there's no roster worth landing on first.
el("onboarding-add-btn").addEventListener("click", () => {
  openManage();
  openForm();
});

// --- Export / import ---

el("export-btn").addEventListener("click", () => {
  backupText.hidden = false;
  backupText.value = JSON.stringify(
    { version: 1, exported: new Date().toISOString(), people },
    null,
    2,
  );
  backupText.select();
});

el("import-btn").addEventListener("click", () => {
  if (backupText.hidden || !backupText.value.trim()) {
    backupText.hidden = false;
    backupText.value = "";
    backupText.placeholder = "Paste exported JSON here, then tap Import again.";
    backupText.focus();
    return;
  }
  let incoming;
  try {
    const parsed = JSON.parse(backupText.value);
    incoming = Array.isArray(parsed) ? parsed : parsed.people;
  } catch {
    alert("That doesn't look like valid exported JSON.");
    return;
  }
  if (!Array.isArray(incoming)) {
    alert("That doesn't look like valid exported JSON.");
    return;
  }
  if (!confirm(`Replace your current list with ${incoming.length} people?`)) return;

  people = incoming;
  savePeople();
  backupText.hidden = true;
  backupText.value = "";
  showManageView();
});

// --- Slider wiring ---

slider.addEventListener("input", () => {
  sliderValue = Number(slider.value);
  const date = dateForSlider(sliderValue);
  paint(date);
});

todayBtn.addEventListener("click", () => {
  sliderValue = CENTER;
  slider.value = String(CENTER);
  const date = dateForSlider(sliderValue);
  paint(date);
});

// --- Boot ---

populateSelects();
el("app-version").textContent = `v${VERSION}`;
// Only worth warning about before there's anything to lose.
if (people.length === 0 && !isStandalone()) {
  document.querySelector(".a2hs-hint").hidden = false;
}
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
