'use strict';

function parseNumber(text) {
  const value = text.trim().replace(/^−/, '-').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
    throw new RangeError('Введіть число.');
  }
  return Number(value);
}

function scale(value, { from, to, curve, descending, inverse }) {
  const [low, high] = from;
  const [start, end] = descending ? [to[1], to[0]] : to;
  const span = high - low;
  const signalSpan = end - start;
  if (!span || !signalSpan || !Number.isFinite(span) || !Number.isFinite(signalSpan)) {
    throw new RangeError('Перевірте межі шкали та сигналу.');
  }
  let fraction = inverse ? (value - start) / signalSpan : (value - low) / span;
  const extrapolated = fraction < 0 || fraction > 1;
  if (extrapolated && curve !== 'linear') {
    throw new RangeError('Значення поза межами нелінійної шкали.');
  }
  if (curve !== 'linear') {
    const square = (curve === 'square') !== inverse;
    fraction = square ? fraction ** 2 : Math.sqrt(fraction);
  }
  const result = inverse ? low + span * fraction : start + signalSpan * fraction;
  if (!Number.isFinite(result)) throw new RangeError('Завелике числове значення.');
  return { value: result, extrapolated };
}

const sensors = {
  pt100: { name: 'Pt100', min: -200, max: 850, unit: 'Ω', nominal: 100, source: 'IEC 60751' },
  pt1000: { name: 'Pt1000', min: -200, max: 850, unit: 'Ω', nominal: 1000, source: 'IEC 60751' },
  k: { name: 'Термопара K', min: -200, max: 1372, unit: 'мВ', source: 'NIST ITS-90' },
  j: { name: 'Термопара J', min: -210, max: 1200, unit: 'мВ', source: 'NIST ITS-90' },
  t: { name: 'Термопара T', min: -200, max: 400, unit: 'мВ', source: 'NIST ITS-90' },
};

// NIST Monograph 175 reference polynomials. Coefficients produce millivolts.
const thermocouple = {
  k: {
    split: 0,
    lower: [0, 3.94501280250e-2, 2.36223735980e-5, -3.28589067840e-7, -4.99048287770e-9,
      -6.75090591730e-11, -5.74103274280e-13, -3.10888728940e-15, -1.04516093650e-17,
      -1.98892668780e-20, -1.63226974860e-23],
    upper: [-1.76004136860e-2, 3.89212049750e-2, 1.85587700320e-5, -9.94575928740e-8,
      3.18409457190e-10, -5.60728448890e-13, 5.60750590590e-16, -3.20207200030e-19,
      9.71511471520e-23, -1.21047212750e-26],
  },
  j: {
    split: 760,
    lower: [0, 5.03811878150e-2, 3.04758369300e-5, -8.56810657200e-8, 1.32281952950e-10,
      -1.70529583370e-13, 2.09480906970e-16, -1.25383953360e-19, 1.56317256970e-23],
    upper: [2.96456256810e2, -1.49761277860, 3.17871039240e-3, -3.18476867010e-6,
      1.57208190040e-9, -3.06913690560e-13],
  },
  t: {
    split: 0,
    lower: [0, 3.87481063640e-2, 4.41944343470e-5, 1.18443231050e-7, 2.00329735540e-8,
      9.01380195590e-10, 2.26511565930e-11, 3.60711542050e-13, 3.84939398830e-15,
      2.82135219250e-17, 1.42515947790e-19, 4.87686622860e-22, 1.07955392700e-24,
      1.39450270620e-27, 7.97951539270e-31],
    upper: [0, 3.87481063640e-2, 3.32922278800e-5, 2.06182434040e-7, -2.18822568460e-9,
      1.09968809280e-11, -3.08157587720e-14, 4.54791352900e-17, -2.75129016730e-20],
  },
};

function referenceSignal(kind, degrees) {
  const { nominal } = sensors[kind];
  if (nominal) {
    const correction = degrees < 0 ? -4.183e-12 * (degrees - 100) * degrees ** 3 : 0;
    return nominal * (1 + 3.9083e-3 * degrees - 5.775e-7 * degrees ** 2 + correction);
  }
  const { split, lower, upper } = thermocouple[kind];
  const polynomial = (degrees <= split ? lower : upper).reduceRight((sum, coefficient) => {
    return sum * degrees + coefficient;
  }, 0);
  const correction = kind === 'k' && degrees > 0
    ? 0.1185976 * Math.exp(-0.0001183432 * (degrees - 126.9686) ** 2)
    : 0;
  return polynomial + correction;
}

function checkTemperature(degrees, { min, max }) {
  if (degrees < min || degrees > max) throw new RangeError(`Допустимий діапазон — від ${min} до ${max} °C.`);
}

function temperature(kind, value, inverse = false, coldJunction = 0) {
  const sensor = sensors[kind];
  let offset = 0;
  if (!sensor.nominal) {
    checkTemperature(coldJunction, sensor);
    offset = referenceSignal(kind, coldJunction);
  }
  if (!inverse) {
    checkTemperature(value, sensor);
    return referenceSignal(kind, value) - offset;
  }
  let { min, max } = sensor;
  const low = referenceSignal(kind, min);
  const high = referenceSignal(kind, max);
  const signal = value + offset;
  // Allow the last displayed digit at the bounds to round away from the valid range.
  const rounding = 0.5 * 10 ** (Math.floor(Math.log10(Math.max(Math.abs(value), 1))) - 8) + 1e-10;
  if (signal < low - rounding || signal > high + rounding) {
    throw new RangeError('Сигнал поза діапазоном вибраного датчика.');
  }
  for (let step = 0; step < 48; step++) {
    const middle = (min + max) / 2;
    if (referenceSignal(kind, middle) < signal) min = middle;
    else max = middle;
  }
  return (min + max) / 2;
}

const quantities = {
  pressure: { name: 'Тиск', units: { pa: ['Па', 1], kpa: ['кПа', 1000], mpa: ['МПа', 1e6],
    bar: ['бар', 1e5], mbar: ['мбар', 100], psi: ['psi', 6894.757293168],
    kgf: ['кгс/см²', 98066.5], atmosphere: ['атм', 101325] } },
  temperature: { name: 'Температура', units: { c: ['°C', 1], f: ['°F', 5 / 9, 32], k: ['K', 1, 273.15] } },
  massFlow: { name: 'Масова витрата', units: { kgHour: ['кг/год', 1], kgSecond: ['кг/с', 3600],
    tonHour: ['т/год', 1000], gramSecond: ['г/с', 3.6], poundHour: ['lb/h', 0.45359237] } },
  volumeFlow: { name: 'Об’ємна витрата', units: { m3Hour: ['м³/год', 1], m3Second: ['м³/с', 3600],
    literMinute: ['л/хв', 0.06], literSecond: ['л/с', 3.6], literHour: ['л/год', 0.001],
    gallonMinute: ['US gal/min', 0.22712470704] } },
  density: { name: 'Густина', units: { kgM3: ['кг/м³', 1], gramCm3: ['г/см³', 1000],
    kgLiter: ['кг/л', 1000], poundFt3: ['lb/ft³', 0.45359237 / 0.3048 ** 3] } },
  length: { name: 'Довжина', units: { m: ['м', 1], mm: ['мм', 0.001], cm: ['см', 0.01],
    km: ['км', 1000], in: ['in', 0.0254], ft: ['ft', 0.3048] } },
  area: { name: 'Площа', units: { m2: ['м²', 1], cm2: ['см²', 0.0001], mm2: ['мм²', 1e-6],
    ha: ['га', 10000], ft2: ['ft²', 0.3048 ** 2], in2: ['in²', 0.0254 ** 2] } },
  volume: { name: 'Об’єм', units: { m3: ['м³', 1], l: ['л', 0.001], ml: ['мл', 1e-6],
    ft3: ['ft³', 0.3048 ** 3], gallon: ['US gal', 0.003785411784] } },
};

function convertUnits(quantity, from, to, value) {
  const units = quantities[quantity]?.units;
  if (!units?.[from] || !units[to]) throw new RangeError('Виберіть сумісні одиниці.');
  if (from === to) return value;
  const [, fromFactor, fromOffset = 0] = units[from];
  const [, toFactor, toOffset = 0] = units[to];
  const result = (value - fromOffset) * (fromFactor / toFactor) + toOffset;
  if (!Number.isFinite(result)) throw new RangeError('Завелике числове значення.');
  return result;
}

const kvpiaCalculations = { parseNumber, scale, sensors, temperature, quantities, convertUnits };
if (typeof module !== 'undefined' && module.exports) module.exports = kvpiaCalculations;
