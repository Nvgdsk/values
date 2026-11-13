'use strict';

const byId = (id) => document.getElementById(id);
const presets = {
  ma420: [4, 20, 'мА'], ma020: [0, 20, 'мА'], ma05: [0, 5, 'мА'],
  v01: [0, 1, 'В'], v010: [0, 10, 'В'], air: [0.2, 1, 'кгс/см²'],
};
const regular = new Intl.NumberFormat('uk-UA', { useGrouping: false, maximumSignificantDigits: 9 });
const display = (n) => Math.abs(n) >= 1e9 || (n !== 0 && Math.abs(n) < 1e-5)
  ? n.toExponential(6).replace('.', ',')
  : regular.format(n || 0);
const textValue = (id) => byId(id).value;
const settingsKey = 'kvpia.settings.v1';
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(settingsKey)) ?? {};
} catch {
  // The calculators still work if local storage is unavailable.
}

function fillSelect(id, entries) {
  byId(id).replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
}

function restore(form) {
  for (const field of form.elements) {
    if (field.type === 'radio' && saved[field.name]) {
      field.checked = saved[field.name] === field.value;
    } else if (field.id && typeof saved[field.id] === 'string') {
      if (field.tagName !== 'SELECT' || [...field.options].some((option) => option.value === saved[field.id])) {
        field.value = saved[field.id];
      }
    }
  }
}

function remember(field) {
  if (field.id) saved[field.id] = field.value;
  if (field.type === 'radio' && field.checked) saved[field.name] = field.value;
  try { localStorage.setItem(settingsKey, JSON.stringify(saved)); } catch { /* Storage is optional. */ }
}

function showError(id, error) {
  const message = byId(id);
  message.textContent = error?.message ?? '';
  message.hidden = !error;
  const invalid = message.closest('form').querySelector('[aria-invalid="true"]');
  if (invalid) invalid.setAttribute('aria-describedby', id);
}

function validate(fieldId, operation) {
  try {
    const result = operation();
    byId(fieldId).removeAttribute('aria-invalid');
    return result;
  } catch (error) {
    byId(fieldId).setAttribute('aria-invalid', 'true');
    throw error;
  }
}

function number(id) {
  return validate(id, () => kvpiaCalculations.parseNumber(textValue(id)));
}

function range(lowId, highId) {
  const low = number(lowId);
  const high = number(highId);
  return validate(highId, () => {
    if (high <= low) throw new RangeError('Верхня межа має бути більшою за нижню.');
    return [low, high];
  });
}

function result(id, value, unit = '') {
  const output = byId(id);
  output.value = value === undefined ? '—' : display(value);
  byId(`${id}-unit`).textContent = unit;
  const copy = document.querySelector(`[data-copy="${id}"]`);
  copy.disabled = value === undefined;
  copy.dataset.text = `${output.value} ${unit}`.trim();
}

function calculateScale() {
  const form = byId('scale-form');
  const inverse = form.elements.scaleDirection.value === 'inverse';
  const custom = textValue('preset') === 'custom';
  const physicalUnit = textValue('scale-unit').trim();
  const signalUnit = custom ? textValue('signal-unit').trim() : presets[textValue('preset')][2];
  byId('custom-signal').hidden = !custom;
  const inputUnit = inverse ? signalUnit : physicalUnit;
  const outputUnit = inverse ? physicalUnit : signalUnit;
  byId('scale-input-label').textContent = `${inverse ? 'Значення сигналу' : 'Значення шкали'}${inputUnit ? `, ${inputUnit}` : ''}`;
  byId('scale-warning').hidden = true;
  for (const id of ['scale-low', 'scale-high', 'signal-low', 'signal-high', 'scale-value']) {
    byId(id).removeAttribute('aria-invalid');
  }
  try {
    const from = range('scale-low', 'scale-high');
    const to = custom ? range('signal-low', 'signal-high') : presets[textValue('preset')].slice(0, 2);
    const input = number('scale-value');
    const descending = textValue('slope') === 'down';
    const calculated = validate('scale-value', () => kvpiaCalculations.scale(input, {
      from, to, curve: textValue('curve'), descending, inverse,
    }));
    const outputRange = inverse ? from : to;
    const [start, end] = outputRange;
    const ratio = (calculated.value - start) / (end - start);
    byId('scale-meter').style.setProperty('--progress', `${Math.max(0, Math.min(1, ratio)) * 100}%`);
    byId('meter-start').textContent = `${display(start)} ${outputUnit}`.trim();
    byId('meter-end').textContent = `${display(end)} ${outputUnit}`.trim();
    byId('scale-warning').hidden = !calculated.extrapolated;
    result('scale-result', calculated.value, outputUnit);
    showError('scale-error');
  } catch (error) {
    byId('scale-meter').style.setProperty('--progress', '0%');
    byId('meter-start').textContent = '';
    byId('meter-end').textContent = '';
    result('scale-result', undefined, outputUnit);
    showError('scale-error', error);
  }
}

function calculateSensor() {
  const kind = textValue('sensor-type');
  const sensor = sensors[kind];
  const inverse = byId('sensor-form').elements.sensorDirection.value === 'inverse';
  const thermocouple = !sensor.nominal;
  const outputUnit = inverse ? '°C' : sensor.unit;
  byId('cold-group').hidden = !thermocouple;
  byId('sensor-forward').textContent = `°C → ${sensor.unit}`;
  byId('sensor-inverse').textContent = `${sensor.unit} → °C`;
  byId('sensor-input-label').textContent = inverse
    ? `${thermocouple ? 'ТермоЕРС' : 'Опір'}, ${sensor.unit}`
    : 'Температура, °C';
  byId('sensor-range').textContent = `${sensor.min}…${sensor.max} °C · ${sensor.source}`;
  byId('sensor-value').removeAttribute('aria-invalid');
  byId('cold-junction').removeAttribute('aria-invalid');
  try {
    const cold = thermocouple ? number('cold-junction') : 0;
    if (cold < sensor.min || cold > sensor.max) {
      validate('cold-junction', () => {
        throw new RangeError(`Холодний спай — від ${sensor.min} до ${sensor.max} °C.`);
      });
    }
    const input = number('sensor-value');
    const value = validate('sensor-value', () => kvpiaCalculations.temperature(kind, input, inverse, cold));
    result('sensor-result', value, outputUnit);
    showError('sensor-error');
  } catch (error) {
    result('sensor-result', undefined, outputUnit);
    showError('sensor-error', error);
  }
}

function setUnitOptions(preferred) {
  const units = quantities[textValue('quantity')].units;
  fillSelect('from-unit', Object.entries(units).map(([key, [label]]) => [key, label]));
  if (Object.hasOwn(units, preferred)) byId('from-unit').value = preferred;
}

function calculateUnits() {
  const list = byId('unit-results');
  const quantity = textValue('quantity');
  const from = textValue('from-unit');
  try {
    const input = number('units-value');
    const rows = Object.entries(quantities[quantity].units).filter(([key]) => key !== from).map(([key, [unit]]) => {
      const value = validate('units-value', () => kvpiaCalculations.convertUnits(quantity, from, key, input));
      const item = document.createElement('li');
      const reading = document.createElement('strong');
      reading.textContent = `${display(value)} ${unit}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Копіювати';
      button.setAttribute('aria-label', `Копіювати ${reading.textContent}`);
      button.dataset.text = reading.textContent;
      item.append(reading, button);
      return item;
    });
    list.replaceChildren(...rows);
    showError('units-error');
  } catch (error) {
    list.replaceChildren();
    showError('units-error', error);
  }
}

function prepareForm(id, calculate) {
  const form = byId(id);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', ({ target }) => {
    remember(target);
    if (target.id === 'quantity') {
      setUnitOptions();
      remember(byId('from-unit'));
    }
    calculate();
  });
}

fillSelect('sensor-type', Object.entries(sensors).map(([key, sensor]) => [key, sensor.name]));
fillSelect('quantity', Object.entries(quantities).map(([key, quantity]) => [key, quantity.name]));
restore(byId('scale-form'));
restore(byId('sensor-form'));
restore(byId('units-form'));
setUnitOptions(saved['from-unit'] ?? (textValue('quantity') === 'pressure' ? 'bar' : undefined));
prepareForm('scale-form', calculateScale);
prepareForm('sensor-form', calculateSensor);
prepareForm('units-form', calculateUnits);
calculateScale();
calculateSensor();
calculateUnits();

for (const input of document.querySelectorAll('input[inputmode="decimal"]')) {
  const toggle = document.createElement('button');
  toggle.className = 'sign';
  toggle.type = 'button';
  toggle.textContent = '±';
  toggle.setAttribute('aria-label', `Змінити знак · ${input.labels[0].textContent.trim()}`);
  toggle.addEventListener('click', () => {
    const value = input.value.trim();
    input.value = /^[-−]/.test(value) ? value.slice(1) : `-${value.replace(/^\+/, '')}`;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const wrapper = document.createElement('span');
  wrapper.className = 'number-input';
  input.before(wrapper);
  wrapper.append(input, toggle);
}

const pages = [...document.querySelectorAll('[data-page]')];
function navigate(focus = false) {
  const requested = location.hash.slice(1);
  const selected = pages.some(({ id }) => id === requested) ? requested : 'scale';
  for (const page of pages) page.hidden = page.id !== selected;
  for (const link of document.querySelectorAll('.navigation a')) {
    if (link.hash === `#${selected}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (focus) {
    const title = byId(selected).querySelector('h1');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
navigate();
window.addEventListener('hashchange', () => navigate(true));

const normalize = (value) => value.toLocaleLowerCase('uk').replace(/[–—−]/g, '-');
const guide = articles.map((article) => {
  const details = document.createElement('details');
  const heading = document.createElement('summary');
  const body = document.createElement('p');
  heading.textContent = article.title;
  body.textContent = article.body;
  details.append(heading, body);
  if (article.url) {
    const source = document.createElement('p');
    const link = document.createElement('a');
    link.textContent = article.source;
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    source.append(link);
    details.append(source);
  }
  return { details, search: normalize(`${article.title} ${article.keywords} ${article.body}`) };
});
byId('guide-results').append(...guide.map(({ details }) => details));
byId('guide-search').addEventListener('input', ({ target }) => {
  const query = normalize(target.value).trim().split(/\s+/);
  let hasMatch = false;
  for (const { details, search } of guide) {
    details.hidden = !query.every((word) => search.includes(word));
    if (!details.hidden) hasMatch = true;
  }
  byId('no-articles').hidden = hasMatch;
});

let noticeTimer;
document.addEventListener('click', async ({ target }) => {
  const button = target.closest('button[data-text]');
  if (!button) return;
  const notice = byId('notice');
  try {
    await navigator.clipboard.writeText(button.dataset.text);
    notice.textContent = 'Скопійовано';
  } catch {
    notice.textContent = 'Копіювання недоступне. Виділіть результат вручну.';
  }
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3000);
});

const install = byId('install');
const localFile = location.protocol === 'file:';
install.hidden = localFile || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
install.addEventListener('click', () => byId('install-dialog').showModal());

const status = byId('offline-status');
const update = byId('update');
if (localFile) {
  status.textContent = 'Локальний режим';
} else if ('serviceWorker' in navigator) {
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) location.reload();
    controlled = true;
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    const showUpdate = () => { update.hidden = !registration.waiting; };
    showUpdate();
    update.addEventListener('click', () => {
      if (registration.waiting) {
        update.hidden = true;
        registration.waiting.postMessage('activate-update');
      }
    });
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', showUpdate);
    });
    return navigator.serviceWorker.ready;
  }).then(() => {
    status.textContent = 'Готово офлайн';
    status.classList.add('ready');
  }).catch(() => { status.textContent = 'Офлайн недоступний'; });
} else {
  status.textContent = 'Офлайн недоступний';
}
