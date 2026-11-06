const STORAGE_KEY = 'mein-kalender.events.v1';

let events = loadEvents();
let calendarCursor = new Date();
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);
const els = {
  todayText: $('todayText'),
  nextEventText: $('nextEventText'),
  upcomingList: $('upcomingList'),
  emptyState: $('emptyState'),
  searchInput: $('searchInput'),
  filterSelect: $('filterSelect'),
  calendarGrid: $('calendarGrid'),
  monthTitle: $('monthTitle'),
  dialog: $('eventDialog'),
  form: $('eventForm'),
  dialogTitle: $('dialogTitle'),
  eventId: $('eventId'),
  titleInput: $('titleInput'),
  typeInput: $('typeInput'),
  dateInput: $('dateInput'),
  timeInput: $('timeInput'),
  reminderInput: $('reminderInput'),
  yearlyInput: $('yearlyInput'),
  notesInput: $('notesInput'),
  reminderBanner: $('reminderBanner'),
  deleteBtn: $('deleteBtn'),
  calendarExportBtn: $('calendarExportBtn'),
  toast: $('toast'),
  installBtn: $('installBtn'),
};

function loadEvents() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  renderAll();
}

function localDateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoFromLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextOccurrence(event, from = todayStart()) {
  const base = localDateFromISO(event.date);
  if (!event.yearly) return base;

  let candidate = new Date(from.getFullYear(), base.getMonth(), base.getDate());
  if (candidate < from) candidate = new Date(from.getFullYear() + 1, base.getMonth(), base.getDate());
  return candidate;
}

function occurrenceInMonth(event, year, monthIndex) {
  const base = localDateFromISO(event.date);
  if (event.yearly) {
    if (base.getMonth() !== monthIndex) return null;
    return new Date(year, monthIndex, base.getDate());
  }
  if (base.getFullYear() === year && base.getMonth() === monthIndex) return base;
  return null;
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / ms);
}

function typeLabel(type) {
  return ({ birthday: 'Geburtstag', appointment: 'Termin', other: 'Sonstiges' })[type] || 'Eintrag';
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat('de-DE', options).format(date);
}

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function ageText(event, occurrence) {
  if (event.type !== 'birthday' || !event.yearly) return '';
  const base = localDateFromISO(event.date);
  const age = occurrence.getFullYear() - base.getFullYear();
  return age > 0 ? `${age}. Geburtstag` : '';
}

function reminderLabel(days) {
  const value = Number(days);
  if (value < 0 || Number.isNaN(value)) return '';
  if (value === 0) return 'am selben Tag';
  if (value === 1) return '1 Tag vorher';
  if (value === 7) return '1 Woche vorher';
  return `${value} Tage vorher`;
}

function renderReminders() {
  const today = todayStart();
  const due = events
    .filter(event => Number(event.reminderDays) >= 0)
    .map(event => ({ event, next: nextOccurrence(event, today) }))
    .map(item => ({ ...item, daysUntil: daysBetween(today, item.next) }))
    .filter(item => item.daysUntil >= 0 && item.daysUntil <= Number(item.event.reminderDays))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (!due.length) {
    els.reminderBanner.classList.add('hidden');
    els.reminderBanner.innerHTML = '';
    if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
    return;
  }

  const lines = due.slice(0, 4).map(({ event, daysUntil }) => {
    const when = daysUntil === 0 ? 'heute' : daysUntil === 1 ? 'morgen' : `in ${daysUntil} Tagen`;
    return `<div class="reminder-item"><strong>${escapeHtml(event.title)}</strong><span>${when}</span></div>`;
  }).join('');

  els.reminderBanner.innerHTML = `
    <div class="reminder-title">🔔 Erinnerung</div>
    ${lines}
    ${due.length > 4 ? `<div class="reminder-more">+${due.length - 4} weitere</div>` : ''}
  `;
  els.reminderBanner.classList.remove('hidden');
  if ('setAppBadge' in navigator) navigator.setAppBadge(due.length).catch(() => {});
}

function renderHeader() {
  const now = new Date();
  els.todayText.textContent = formatDate(now, { weekday: 'long', day: 'numeric', month: 'long' });

  const upcoming = events
    .map(event => ({ event, next: nextOccurrence(event) }))
    .filter(item => item.next >= todayStart())
    .sort((a, b) => a.next - b.next || (a.event.time || '').localeCompare(b.event.time || ''));

  if (!upcoming.length) {
    els.nextEventText.textContent = 'Noch keine kommenden Einträge.';
    return;
  }

  const { event, next } = upcoming[0];
  const diff = daysBetween(todayStart(), next);
  let when = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : `in ${diff} Tagen`;
  els.nextEventText.textContent = `Als Nächstes: ${event.title} – ${when}.`;
}

function renderUpcoming() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filter = els.filterSelect.value;
  const from = todayStart();

  const items = events
    .filter(event => filter === 'all' || event.type === filter)
    .filter(event => !query || `${event.title} ${event.notes || ''}`.toLowerCase().includes(query))
    .map(event => ({ event, next: nextOccurrence(event, from) }))
    .filter(item => item.event.yearly || item.next >= from)
    .sort((a, b) => a.next - b.next || (a.event.time || '').localeCompare(b.event.time || ''));

  els.upcomingList.innerHTML = '';
  els.emptyState.classList.toggle('hidden', items.length > 0 || events.length > 0);

  if (!items.length && events.length) {
    els.upcomingList.innerHTML = '<div class="empty card"><h3>Keine Treffer</h3><p>Für diesen Filter gibt es gerade keine passenden Einträge.</p></div>';
    return;
  }

  items.forEach(({ event, next }) => {
    const card = document.createElement('article');
    card.className = 'event-card';
    const diff = daysBetween(from, next);
    const relative = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : `In ${diff} Tagen`;
    const age = ageText(event, next);
    const time = event.time ? ` · ${event.time} Uhr` : '';
    const yearly = event.yearly ? '<span class="badge">jährlich</span>' : '';
    const reminder = Number(event.reminderDays) >= 0 ? `<span class="badge">🔔 ${reminderLabel(event.reminderDays)}</span>` : '';
    const note = event.notes ? ` · ${escapeHtml(event.notes)}` : '';

    card.innerHTML = `
      <div class="date-tile">
        <strong>${next.getDate()}</strong>
        <span>${formatDate(next, { month: 'short' }).replace('.', '')}</span>
      </div>
      <div>
        <div class="event-title">${escapeHtml(event.title)}</div>
        <div class="event-meta">
          <span>${typeLabel(event.type)}${age ? ` · ${age}` : ''}${time}${note}</span>
          ${yearly}
          ${reminder}
          <span class="badge">${relative}</span>
        </div>
      </div>
      <button class="event-edit" type="button" aria-label="${escapeHtml(event.title)} bearbeiten">•••</button>
    `;
    card.querySelector('.event-edit').addEventListener('click', () => openDialog(event));
    card.addEventListener('dblclick', () => openDialog(event));
    els.upcomingList.appendChild(card);
  });
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  els.monthTitle.textContent = formatDate(new Date(year, month, 1), { month: 'long', year: 'numeric' });
  els.calendarGrid.innerHTML = '';

  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const today = todayStart();

  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const cell = document.createElement('div');
    cell.className = 'day';
    if (date.getMonth() !== month) cell.classList.add('outside');
    if (isoFromLocalDate(date) === isoFromLocalDate(today)) cell.classList.add('today');

    const dayEvents = events
      .map(event => ({ event, occ: occurrenceInMonth(event, date.getFullYear(), date.getMonth()) }))
      .filter(item => item.occ && item.occ.getDate() === date.getDate())
      .sort((a, b) => (a.event.time || '').localeCompare(b.event.time || ''));

    cell.innerHTML = `<div class="day-number">${date.getDate()}</div><div class="day-events"></div>`;
    const list = cell.querySelector('.day-events');
    dayEvents.forEach(({ event }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-event';
      btn.textContent = event.title;
      btn.title = event.title;
      btn.addEventListener('click', () => openDialog(event));
      list.appendChild(btn);
    });

    cell.addEventListener('dblclick', (e) => {
      if (e.target.closest('.day-event')) return;
      openDialog(null, date);
    });
    els.calendarGrid.appendChild(cell);
  }
}

function renderAll() {
  renderHeader();
  renderReminders();
  renderUpcoming();
  renderCalendar();
}

function openDialog(event = null, presetDate = null) {
  els.form.reset();
  els.eventId.value = event?.id || '';
  els.dialogTitle.textContent = event ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  els.deleteBtn.classList.toggle('hidden', !event);
  els.calendarExportBtn.classList.toggle('hidden', !event);

  if (event) {
    els.titleInput.value = event.title;
    els.typeInput.value = event.type;
    els.dateInput.value = event.date;
    els.timeInput.value = event.time || '';
    els.reminderInput.value = String(Number.isFinite(Number(event.reminderDays)) ? Number(event.reminderDays) : -1);
    els.yearlyInput.checked = !!event.yearly;
    els.notesInput.value = event.notes || '';
  } else {
    els.typeInput.value = 'birthday';
    els.dateInput.value = isoFromLocalDate(presetDate || new Date());
    els.reminderInput.value = '3';
    els.yearlyInput.checked = true;
  }

  els.dialog.showModal();
  requestAnimationFrame(() => els.titleInput.focus());
}

function closeDialog() {
  els.dialog.close();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!els.form.reportValidity()) return;

  const id = els.eventId.value || crypto.randomUUID();
  const item = {
    id,
    title: els.titleInput.value.trim(),
    type: els.typeInput.value,
    date: els.dateInput.value,
    time: els.timeInput.value,
    reminderDays: Number(els.reminderInput.value),
    yearly: els.yearlyInput.checked,
    notes: els.notesInput.value.trim(),
    updatedAt: new Date().toISOString(),
  };

  const index = events.findIndex(e => e.id === id);
  if (index >= 0) events[index] = item; else events.push(item);
  saveEvents();
  closeDialog();
  showToast('Gespeichert');
});

els.typeInput.addEventListener('change', () => {
  if (els.typeInput.value === 'birthday') els.yearlyInput.checked = true;
});

els.deleteBtn.addEventListener('click', () => {
  const id = els.eventId.value;
  const item = events.find(e => e.id === id);
  if (!item) return;
  if (!confirm(`„${item.title}“ wirklich löschen?`)) return;
  events = events.filter(e => e.id !== id);
  saveEvents();
  closeDialog();
  showToast('Gelöscht');
});

$('openNewBtn').addEventListener('click', () => openDialog());
$('emptyNewBtn').addEventListener('click', () => openDialog());
$('closeDialogBtn').addEventListener('click', closeDialog);
$('cancelBtn').addEventListener('click', closeDialog);
els.searchInput.addEventListener('input', renderUpcoming);
els.filterSelect.addEventListener('change', renderUpcoming);

$('prevMonthBtn').addEventListener('click', () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCalendar();
});
$('nextMonthBtn').addEventListener('click', () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
    btn.classList.add('active');
    $(`${btn.dataset.view}View`).classList.add('active-view');
  });
});

$('exportBtn').addEventListener('click', () => {
  const payload = {
    app: 'Mein Kalender',
    version: 1,
    exportedAt: new Date().toISOString(),
    events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mein-kalender-backup-${isoFromLocalDate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast('Backup exportiert');
});

$('importInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(imported)) throw new Error('Ungültiges Format');
    const cleaned = imported.filter(x => x && x.id && x.title && x.date).map(x => ({
      id: String(x.id),
      title: String(x.title),
      type: ['birthday','appointment','other'].includes(x.type) ? x.type : 'other',
      date: String(x.date),
      time: x.time ? String(x.time) : '',
      reminderDays: Number.isFinite(Number(x.reminderDays)) ? Number(x.reminderDays) : -1,
      yearly: !!x.yearly,
      notes: x.notes ? String(x.notes) : '',
      updatedAt: x.updatedAt || new Date().toISOString(),
    }));
    if (!confirm(`${cleaned.length} Einträge importieren? Bereits vorhandene Einträge mit derselben ID werden aktualisiert.`)) return;
    const byId = new Map(events.map(x => [x.id, x]));
    cleaned.forEach(x => byId.set(x.id, x));
    events = Array.from(byId.values());
    saveEvents();
    showToast('Backup importiert');
  } catch {
    alert('Diese Datei konnte nicht als Kalender-Backup gelesen werden.');
  } finally {
    e.target.value = '';
  }
});

$('clearBtn').addEventListener('click', () => {
  if (!events.length) return showToast('Keine Einträge vorhanden');
  if (!confirm('Wirklich alle lokalen Einträge auf diesem Gerät löschen?')) return;
  events = [];
  saveEvents();
  showToast('Alle Einträge gelöscht');
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  els.installBtn.classList.remove('hidden');
});

els.installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

renderAll();
