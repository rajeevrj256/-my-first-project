'use strict';

// Entries are stored on this device only, in localStorage, as a compact
// JSON array of [timestampMs, weightKg] pairs (about 22 bytes per entry).
const STORE_KEY = 'weightTracker.entries.v1';
const RANGE_KEY = 'weightTracker.range';
const HINT_KEY = 'weightTracker.hintDismissed';
const DAY = 864e5;
const MIN_KG = 10;
const MAX_KG = 500;
const HISTORY_PAGE = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);

const fmt = {
  weight: (w) => w.toFixed(1),
  day: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  dayShort: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
  dayYear: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  monthYear: new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }),
  time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
};

let entries = loadEntries();
let rangeDays = loadRange();
let historyLimit = HISTORY_PAGE;

/* ---------- storage ---------- */

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function isValidEntry(e) {
  return Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[1] >= MIN_KG && e[1] <= MAX_KG;
}

function loadEntries() {
  try {
    const data = JSON.parse(readStore(STORE_KEY) || '[]');
    return Array.isArray(data) ? data.filter(isValidEntry).sort((a, b) => a[0] - b[0]) : [];
  } catch {
    return [];
  }
}

function saveEntries() {
  return writeStore(STORE_KEY, JSON.stringify(entries));
}

function loadRange() {
  const raw = readStore(RANGE_KEY);
  const v = Number(raw);
  return raw !== null && [0, 30, 90, 180, 365].includes(v) ? v : 90;
}

function requestPersistence() {
  // Asks the browser not to evict this app's storage when the device is low on space.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* ---------- dates & numbers ---------- */

const round1 = (w) => Math.round(w * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');

function noonOf(t) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
}

function mondayNoonOf(t) {
  const d = new Date(t);
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime();
}

function toLocalInputValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInputValue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
}

function signed(diff) {
  const r = round1(diff);
  if (r === 0) return '±0.0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1);
}

/* ---------- series ---------- */

// One point per calendar day; several entries on the same day are averaged.
function dailySeries() {
  const days = new Map();
  for (const [t, w] of entries) {
    const x = noonOf(t);
    const g = days.get(x) || { x, sum: 0, n: 0 };
    g.sum += w;
    g.n += 1;
    days.set(x, g);
  }
  return [...days.values()].sort((a, b) => a.x - b.x).map((g) => ({ x: g.x, y: g.sum / g.n, n: g.n }));
}

// One point per Monday-Sunday week: the average of that week's daily values.
function weeklySeries(daily) {
  const weeks = new Map();
  for (const d of daily) {
    const x = mondayNoonOf(d.x);
    const g = weeks.get(x) || { x, sum: 0, n: 0 };
    g.sum += d.y;
    g.n += 1;
    weeks.set(x, g);
  }
  return [...weeks.values()].sort((a, b) => a.x - b.x).map((g) => ({ x: g.x, y: g.sum / g.n, n: g.n }));
}

function rangeStart() {
  if (!rangeDays) return -Infinity;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (rangeDays - 1)).getTime();
}

/* ---------- chart ---------- */

function svgEl(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max) {
  const padding = Math.max((max - min) * 0.1, 0.3);
  min -= padding;
  max += padding;
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { ticks, lo, hi, decimals: step < 1 ? 1 : 0 };
}

function renderChart(box, points, { label, describe, emptyText }) {
  box.replaceChildren();
  box._hide = null;
  if (!points.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = emptyText;
    box.appendChild(p);
    box.removeAttribute('tabindex');
    box.removeAttribute('aria-label');
    return;
  }

  const W = Math.max(260, box.clientWidth);
  const H = box.clientHeight || 200;
  const m = { top: 10, right: 42, bottom: 24, left: 36 };
  const inset = 8;
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const ys = points.map((p) => p.y);
  const { ticks, lo, hi, decimals } = niceTicks(Math.min(...ys), Math.max(...ys));
  let x0 = points[0].x;
  let x1 = points[points.length - 1].x;
  if (x0 === x1) { x0 -= 3 * DAY; x1 += 3 * DAY; }
  const sx = (x) => m.left + inset + ((x - x0) / (x1 - x0)) * (plotW - 2 * inset);
  const sy = (y) => m.top + ((hi - y) / (hi - lo)) * plotH;
  const crisp = (v) => Math.round(v) + 0.5;

  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, box);

  // Horizontal gridlines with y labels; the lowest one is the baseline.
  ticks.forEach((t, i) => {
    const y = crisp(sy(t));
    svgEl('line', { x1: m.left, x2: W - m.right, y1: y, y2: y, class: i === 0 ? 'axis' : 'grid' }, svg);
    const text = svgEl('text', { x: m.left - 6, y, dy: '0.32em', 'text-anchor': 'end', class: 'tick' }, svg);
    text.textContent = t.toFixed(decimals);
  });

  // X labels: evenly spaced dates, never more labels than days in view.
  const span = x1 - x0;
  const tickFmt = span > 300 * DAY ? fmt.monthYear : fmt.dayShort;
  if (points.length === 1) {
    const text = svgEl('text', { x: sx(points[0].x), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg);
    text.textContent = tickFmt.format(points[0].x);
  } else {
    const n = Math.max(2, Math.min(Math.floor(plotW / 72), Math.round(span / DAY) + 1, 5));
    for (let i = 0; i < n; i++) {
      const xv = x0 + (span * i) / (n - 1);
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const text = svgEl('text', { x: sx(xv), y: H - 6, 'text-anchor': anchor, class: 'tick' }, svg);
      text.textContent = tickFmt.format(xv);
    }
  }

  const cross = svgEl('line', { y1: m.top, y2: m.top + plotH, class: 'cross', visibility: 'hidden' }, svg);

  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    svgEl('path', { d, class: 'line' }, svg);
  }

  // Markers on every point while they fit; otherwise only the latest one.
  const showAllDots = points.length <= 40 && plotW / points.length >= 6;
  points.forEach((p, i) => {
    if (showAllDots || i === points.length - 1) svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: 5, class: 'dot' }, svg);
  });

  const last = points[points.length - 1];
  const endLabel = svgEl('text', { x: sx(last.x) + 9, y: sy(last.y), dy: '0.32em', class: 'end-label' }, svg);
  endLabel.textContent = fmt.weight(last.y);

  const focusDot = svgEl('circle', { r: 6, class: 'dot', visibility: 'hidden' }, svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('aria-live', 'polite');
  const tipValue = document.createElement('strong');
  const tipLabel = document.createElement('span');
  tip.append(tipValue, tipLabel);
  box.appendChild(tip);

  let active = -1;

  function show(i) {
    active = i;
    const p = points[i];
    const cx = sx(p.x);
    const cy = sy(p.y);
    cross.setAttribute('x1', crisp(cx));
    cross.setAttribute('x2', crisp(cx));
    cross.setAttribute('visibility', 'visible');
    focusDot.setAttribute('cx', cx);
    focusDot.setAttribute('cy', cy);
    focusDot.setAttribute('visibility', 'visible');
    tipValue.textContent = `${fmt.weight(p.y)} kg`;
    tipLabel.textContent = describe(p);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(0, cx - tw / 2), W - tw)}px`;
    tip.style.top = `${cy - th - 14 >= 0 ? cy - th - 14 : cy + 14}px`;
  }

  function hide() {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    focusDot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }

  function nearest(clientX) {
    const px = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(sx(p.x) - px);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

  box._hide = hide;
  box.tabIndex = 0;
  box.setAttribute('aria-label',
    `${label}: ${points.length} point${points.length > 1 ? 's' : ''}, latest ${fmt.weight(last.y)} kg. Use left and right arrow keys to read values.`);
  box.onkeydown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const start = active < 0 ? points.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.max(0, Math.min(points.length - 1, start)));
    } else if (e.key === 'Escape') {
      hide();
    }
  };
  box.onfocus = () => { if (active < 0) show(points.length - 1); };
  box.onblur = hide;
}

/* ---------- views ---------- */

function renderHero() {
  if (!entries.length) {
    $('latestVal').textContent = '–';
    $('latestSub').textContent = 'No entries yet. Add your first weight below.';
    return;
  }
  const [t, w] = entries[entries.length - 1];
  let sub = `${fmt.day.format(t)}, ${fmt.time.format(t)}`;
  if (entries.length > 1) sub += ` · ${signed(w - entries[entries.length - 2][1])} kg vs previous`;
  $('latestVal').textContent = fmt.weight(w);
  $('latestSub').textContent = sub;
}

function renderCharts() {
  const from = rangeStart();
  const daily = dailySeries();
  const weekly = weeklySeries(daily);
  const empty = entries.length ? 'No entries in this range' : 'Your graph appears after the first entry';

  renderChart($('dailyChart'), daily.filter((p) => p.x >= from), {
    label: 'Daily weight chart',
    describe: (p) => fmt.day.format(p.x) + (p.n > 1 ? ` · avg of ${p.n} entries` : ''),
    emptyText: empty,
  });

  const fromWeek = rangeDays ? mondayNoonOf(from) : -Infinity;
  const weeks = weekly.filter((p) => p.x >= fromWeek);
  renderChart($('weeklyChart'), weeks, {
    label: 'Weekly average chart',
    describe: (p) => `Week of ${fmt.dayShort.format(p.x)} · ${p.n} day${p.n > 1 ? 's' : ''}`,
    emptyText: empty,
  });

  const body = $('weeklyTable');
  body.replaceChildren();
  body.closest('details').hidden = !weeks.length;
  for (const p of weeks.slice().reverse()) {
    const tr = document.createElement('tr');
    for (const v of [fmt.dayYear.format(p.x), fmt.weight(p.y), String(p.n)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  document.querySelectorAll('.ranges button').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.range) === rangeDays));
  });
}

function renderHistory() {
  const list = $('historyList');
  list.replaceChildren();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Nothing saved yet.';
    list.appendChild(li);
  }
  const newestFirst = entries.slice().reverse();
  for (const entry of newestFirst.slice(0, historyLimit)) {
    const [t, w] = entry;
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = `${fmt.day.format(t)}, ${fmt.time.format(t)}`;
    const weight = document.createElement('span');
    weight.className = 'w';
    weight.textContent = `${fmt.weight(w)} kg`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete ${fmt.weight(w)} kg on ${when.textContent}`);
    del.addEventListener('click', () => deleteEntry(entry, when.textContent));
    li.append(when, weight, del);
    list.appendChild(li);
  }
  const more = $('moreBtn');
  more.hidden = newestFirst.length <= historyLimit;
  more.textContent = `Show more (${newestFirst.length - historyLimit} older)`;
}

function renderStorageInfo() {
  const bytes = (readStore(STORE_KEY) || '').length;
  const n = entries.length;
  $('storageInfo').textContent =
    `${n} entr${n === 1 ? 'y' : 'ies'} · ${(bytes / 1024).toFixed(1)} KB, stored only on this device. ` +
    'Export a backup now and then (for example to Files or iCloud Drive).';
}

function renderAll() {
  renderHero();
  renderCharts();
  renderHistory();
  renderStorageInfo();
}

function say(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(el._timer);
  if (text && !isError) el._timer = setTimeout(() => { el.textContent = ''; }, 4000);
}

/* ---------- actions ---------- */

function addEntry(e) {
  e.preventDefault();
  const msg = $('formMsg');
  const w = parseFloat($('weightIn').value.trim().replace(',', '.'));
  if (!(w >= MIN_KG && w <= MAX_KG)) {
    say(msg, `Enter a weight between ${MIN_KG} and ${MAX_KG} kg.`, true);
    $('weightIn').focus();
    return;
  }
  const t = parseLocalInputValue($('whenIn').value);
  if (!Number.isFinite(t)) {
    say(msg, 'Pick a date and time.', true);
    return;
  }
  if (t > Date.now() + 60 * 60e3) {
    say(msg, 'That date is in the future.', true);
    return;
  }
  const entry = [t, round1(w)];
  entries.push(entry);
  entries.sort((a, b) => a[0] - b[0]);
  if (!saveEntries()) {
    entries.splice(entries.indexOf(entry), 1);
    say(msg, 'Could not save. Storage may be full or blocked.', true);
    return;
  }
  requestPersistence();
  $('weightIn').value = '';
  $('weightIn').blur();
  $('whenIn').value = toLocalInputValue(new Date());
  say(msg, `Saved ${fmt.weight(entry[1])} kg.`);
  renderAll();
}

function deleteEntry(entry, whenText) {
  if (!confirm(`Delete ${fmt.weight(entry[1])} kg from ${whenText}?`)) return;
  const i = entries.indexOf(entry);
  if (i < 0) return;
  entries.splice(i, 1);
  if (!saveEntries()) {
    entries.splice(i, 0, entry);
    alert('Could not delete. Storage may be blocked.');
    return;
  }
  renderAll();
}

function toCSV() {
  const lines = ['datetime,weight_kg'];
  for (const [t, w] of entries) {
    const d = new Date(t);
    lines.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())},${w}`);
  }
  return lines.join('\n') + '\n';
}

async function exportCSV() {
  const msg = $('backupMsg');
  if (!entries.length) {
    say(msg, 'Nothing to export yet.');
    return;
  }
  const d = new Date();
  const name = `weight-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
  const file = new File([toCSV()], name, { type: 'text/csv' });
  // On iPhone the share sheet offers "Save to Files"; elsewhere fall back to a download.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(msg, `Exported ${entries.length} entries.`);
}

async function importCSV(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const msg = $('backupMsg');
  let text;
  try { text = await file.text(); } catch { say(msg, 'Could not read that file.', true); return; }

  const seen = new Set(entries.map(([t, w]) => `${t}|${w}`));
  let added = 0;
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^datetime/i.test(line)) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*,\s*(\d+(?:\.\d+)?)$/.exec(line);
    const entry = m && [new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime(), round1(+m[6])];
    if (!entry || !isValidEntry(entry)) { skipped++; continue; }
    const key = `${entry[0]}|${entry[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    added++;
  }
  if (!added) {
    say(msg, skipped ? `No entries imported (${skipped} unreadable lines).` : 'No new entries in that file.', skipped > 0);
    return;
  }
  entries.sort((a, b) => a[0] - b[0]);
  if (!saveEntries()) {
    entries = loadEntries();
    say(msg, 'Could not save the imported entries.', true);
    return;
  }
  requestPersistence();
  renderAll();
  say(msg, `Imported ${added} entr${added === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} unreadable lines` : ''}.`);
}

/* ---------- setup ---------- */

function setupInstallHint() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!isIOS || installed || readStore(HINT_KEY)) return;
  $('installHint').hidden = false;
  $('hintClose').addEventListener('click', () => {
    $('installHint').hidden = true;
    writeStore(HINT_KEY, '1');
  });
}

$('addForm').addEventListener('submit', addEntry);
$('whenIn').value = toLocalInputValue(new Date());

document.querySelector('.ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  rangeDays = Number(b.dataset.range);
  writeStore(RANGE_KEY, String(rangeDays));
  renderCharts();
});

$('moreBtn').addEventListener('click', () => {
  historyLimit += 30;
  renderHistory();
});

$('exportBtn').addEventListener('click', exportCSV);
$('importIn').addEventListener('change', importCSV);

// Tapping anywhere outside a chart hides its tooltip.
document.addEventListener('pointerdown', (e) => {
  for (const box of document.querySelectorAll('.chart')) {
    if (box._hide && !box.contains(e.target)) box._hide();
  }
});

// Keep the default time current when the app comes back from the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('weightIn').value) {
    $('whenIn').value = toLocalInputValue(new Date());
  }
});

let lastWidth = 0;
window.addEventListener('resize', () => {
  const width = $('dailyChart').clientWidth;
  if (width !== lastWidth) {
    lastWidth = width;
    renderCharts();
  }
});

setupInstallHint();
renderAll();
lastWidth = $('dailyChart').clientWidth;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
