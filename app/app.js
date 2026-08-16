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

  if (grade < PRE_K) return { text: "not in school yet", outOfRange: true };
  if (grade === LAST_GRADE + 1) return { text: "has graduated", outOfRange: true };
  if (grade > LAST_GRADE + 1) {
    return {
      text: `${pluralize(grade - LAST_GRADE, "year")} past high school`,
      outOfRange: true,
    };
  }

  const noun = gradeNoun(grade);
  return {
    text: summer ? `going into ${noun}` : `in ${noun}`,
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

// Splits into the two spans the row renders, so the grade half can be muted
// on its own when it falls outside K-12. The trailing period is static markup.
function sentenceFor(person, date) {
  const birth = parseDate(person.birthdate);

  if (date < birth) {
    const { years, months } = diffYearsMonths(date, birth);
    const parts = [];
    if (years > 0) parts.push(pluralize(years, "year"));
    if (months > 0 || years === 0) parts.push(pluralize(months, "month"));
    return {
      age: ` isn't born for another ${parts.join(", ")}`,
      grade: "",
      outOfRange: true,
    };
  }

  const { years, months } = diffYearsMonths(birth, date);
  const grade = gradeClauseFor(person, date);
  return {
    age: ` is ${agePhrase(years, months)} and `,
    grade: grade.text,
    outOfRange: grade.outOfRange,
  };
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

// --- Elements ---

const el = (id) => document.getElementById(id);

const peopleList = el("people-list");
const onboarding = el("onboarding");
const managePanel = el("manage-panel");
const manageList = el("manage-list");
const manageBtn = el("manage-btn");
const manageCancelBtn = el("manage-cancel-btn");
const timeBar = el("time-bar");
const slider = el("time-slider");
const dateMain = el("date-main");
const dateSub = el("date-sub");
const todayBtn = el("today-btn");
const form = el("person-form");
const formHeading = el("form-heading");
const formCancelBtn = el("form-cancel-btn");
const nameInput = el("person-name");
const birthdateInput = el("person-birthdate");
const anchorYearSelect = el("person-anchor-year");
const gradeSelect = el("person-grade");
const backupText = el("backup-text");

// Cached per-row nodes, so dragging the slider only rewrites two text nodes
// per person instead of rebuilding the list on every input event.
let rowRefs = [];

// --- Rendering ---

function buildList() {
  peopleList.innerHTML = "";
  rowRefs = [];

  for (const person of sortedPeople()) {
    const li = document.createElement("li");
    li.className = "person-row";

    const sentence = document.createElement("p");
    sentence.className = "person-sentence";
    const name = document.createElement("span");
    name.className = "person-name";
    name.textContent = person.name;
    const age = document.createElement("span");
    const grade = document.createElement("span");
    grade.className = "person-grade";
    sentence.append(name, age, grade, document.createTextNode("."));

    const birth = document.createElement("p");
    birth.className = "person-birth";
    birth.textContent = `Born ${formatLongDate(parseDate(person.birthdate))}`;

    li.append(sentence, birth);
    peopleList.append(li);
    rowRefs.push({ person, age, grade });
  }
}

function updateValues(date) {
  for (const { person, age, grade } of rowRefs) {
    const parts = sentenceFor(person, date);
    age.textContent = parts.age;
    grade.textContent = parts.grade;
    grade.classList.toggle("out-of-range", parts.outOfRange);
  }
}

function updateDateDisplay(date) {
  const today = startOfToday();
  if (sliderValue === CENTER) {
    dateMain.textContent = "Today";
    dateSub.textContent = formatLongDate(today);
    todayBtn.hidden = true;
    return;
  }

  dateMain.textContent = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  const ahead = date > today;
  const { years, months } = ahead
    ? diffYearsMonths(today, date)
    : diffYearsMonths(date, today);
  const parts = [];
  if (years > 0) parts.push(pluralize(years, "yr"));
  if (months > 0 || years === 0) parts.push(pluralize(months, "mo"));
  const span = parts.join(", ");
  dateSub.textContent = ahead ? `${span} from now` : `${span} ago`;
  todayBtn.hidden = false;
}

function render() {
  const hasPeople = people.length > 0;
  const managing = !managePanel.hidden;

  onboarding.hidden = hasPeople || managing;
  peopleList.hidden = managing;
  timeBar.hidden = managing || !hasPeople;

  if (!managing) {
    const date = dateForSlider(sliderValue);
    buildList();
    updateValues(date);
    updateDateDisplay(date);
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
}

function resetForm() {
  editingId = null;
  form.reset();
  populateSelects();
  formHeading.textContent = "Add someone";
  formCancelBtn.hidden = true;
}

function startEdit(person) {
  editingId = person.id;
  nameInput.value = person.name;
  birthdateInput.value = person.birthdate;
  // An anchor year outside the default window (an old record, or someone
  // entered far in advance) still has to be selectable.
  if (!anchorYearSelect.querySelector(`option[value="${person.anchorYear}"]`)) {
    const opt = document.createElement("option");
    opt.value = String(person.anchorYear);
    opt.textContent = schoolYearLabel(person.anchorYear);
    anchorYearSelect.prepend(opt);
  }
  anchorYearSelect.value = String(person.anchorYear);
  gradeSelect.value = String(person.anchorGrade);
  formHeading.textContent = `Edit ${person.name}`;
  formCancelBtn.hidden = false;
  nameInput.focus();
}

function buildManageList() {
  manageList.innerHTML = "";
  for (const person of sortedPeople()) {
    const li = document.createElement("li");
    li.className = "manage-row";

    const info = document.createElement("div");
    info.className = "manage-info";
    const name = document.createElement("div");
    name.className = "manage-name";
    name.textContent = person.name;
    const detail = document.createElement("div");
    detail.className = "manage-detail";
    detail.textContent =
      `${formatShortDate(parseDate(person.birthdate))} · ` +
      `${gradeName(person.anchorGrade)} in ${schoolYearLabel(person.anchorYear)}`;
    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manage-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEdit(person));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      if (!confirm(`Remove ${person.name}?`)) return;
      people = people.filter((p) => p.id !== person.id);
      savePeople();
      if (editingId === person.id) resetForm();
      buildManageList();
    });
    actions.append(editBtn, removeBtn);

    li.append(info, actions);
    manageList.append(li);
  }
}

function openManage() {
  managePanel.hidden = false;
  manageBtn.hidden = true;
  manageCancelBtn.hidden = false;
  resetForm();
  buildManageList();
  render();
}

function closeManage() {
  managePanel.hidden = true;
  manageBtn.hidden = false;
  manageCancelBtn.hidden = true;
  backupText.hidden = true;
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
  resetForm();
  buildManageList();
});

formCancelBtn.addEventListener("click", resetForm);
manageBtn.addEventListener("click", openManage);
manageCancelBtn.addEventListener("click", closeManage);
el("onboarding-add-btn").addEventListener("click", openManage);

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
  resetForm();
  buildManageList();
});

// --- Slider wiring ---

slider.addEventListener("input", () => {
  sliderValue = Number(slider.value);
  const date = dateForSlider(sliderValue);
  updateValues(date);
  updateDateDisplay(date);
});

todayBtn.addEventListener("click", () => {
  sliderValue = CENTER;
  slider.value = String(CENTER);
  const date = dateForSlider(sliderValue);
  updateValues(date);
  updateDateDisplay(date);
});

// --- Boot ---

populateSelects();
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
