import assert from 'node:assert/strict';
import test from 'node:test';
import calculations from '../calculations.js';

const { parseNumber, scale, temperature, convertUnits } = calculations;

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected} (±${tolerance})`);
}

test('decimal input accepts both separators and rejects partial values', () => {
  assert.equal(parseNumber('−12,5'), -12.5);
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('1,25e-6'), 0.00000125);
  for (const value of ['', '3,2.1', 'Infinity', '10 кПа']) assert.throws(() => parseNumber(value));
});

const options = { from: [0, 100], to: [4, 20], curve: 'linear', descending: false, inverse: false };

test('scale matches reference endpoints and nonlinear interior points', () => {
  for (const [curve, input, up, down] of [
    ['linear', 50, 12, 12], ['square', 50, 8, 16], ['root', 25, 12, 12],
  ]) {
    for (const descending of [false, true]) {
      const setup = { ...options, curve, descending };
      assert.equal(scale(0, setup).value, descending ? 20 : 4);
      assert.equal(scale(100, setup).value, descending ? 4 : 20);
      const signal = descending ? down : up;
      near(scale(input, setup).value, signal);
      near(scale(signal, { ...setup, inverse: true }).value, input);
    }
  }
});

test('only linear scales allow marked extrapolation', () => {
  assert.deepEqual(scale(125, options), { value: 24, extrapolated: true });
  assert.throws(() => scale(-1, { ...options, curve: 'square' }), RangeError);
  assert.throws(() => scale(21, { ...options, curve: 'root', inverse: true }), RangeError);
  assert.throws(() => scale(0, { ...options, from: [1, 1] }), RangeError);
});

test('IEC platinum reference values and inverse work at both range limits', () => {
  for (const [kind, factor] of [['pt100', 1], ['pt1000', 10]]) {
    for (const [degrees, ohms] of [[-200, 18.52008], [-100, 60.25584], [0, 100], [100, 138.5055], [850, 390.481125]]) {
      near(temperature(kind, degrees), ohms * factor, 1e-8);
      near(temperature(kind, ohms * factor, true), degrees, 1e-7);
    }
  }
});

test('ITS-90 voltages agree with tables to half their published mV digit', () => {
  for (const [kind, degrees, millivolts] of [
    ['k', -200, -5.891], ['k', 100, 4.096], ['k', 1372, 54.886],
    ['j', -210, -8.095], ['j', 100, 5.269], ['j', 760, 42.919], ['j', 1200, 69.553],
    ['t', -200, -5.603], ['t', 100, 4.279], ['t', 400, 20.872],
  ]) {
    const exact = temperature(kind, degrees);
    near(exact, millivolts, 0.0005);
    near(temperature(kind, exact, true), degrees, 0.0001);
  }
});

test('cold junction compensation subtracts reference EMF and inverts the reading', () => {
  const reading = temperature('k', 120, false, 20);
  near(reading, 4.1218, 0.0001);
  near(temperature('k', reading, true, 20), 120);
  assert.throws(() => temperature('k', 1400), RangeError);
  assert.throws(() => temperature('t', 0, false, 401), RangeError);
  assert.throws(() => temperature('pt100', -2, true), RangeError);
});

test('displayed sensor readings at range boundaries can be entered again', () => {
  for (const [kind, degrees] of [['pt1000', -200], ['pt1000', 850], ['k', 1372], ['t', -200], ['j', 1200]]) {
    const displayed = Number(temperature(kind, degrees).toPrecision(9));
    near(temperature(kind, displayed, true), degrees, 0.0001);
  }
});

test('conversions handle offsets and separate mass from volume', () => {
  near(convertUnits('pressure', 'bar', 'kpa', 1), 100);
  near(convertUnits('temperature', 'c', 'f', 0), 32);
  near(convertUnits('temperature', 'f', 'c', -40), -40);
  near(convertUnits('massFlow', 'tonHour', 'kgHour', 1), 1000);
  near(convertUnits('volumeFlow', 'm3Hour', 'literMinute', 60), 1000);
  assert.throws(() => convertUnits('massFlow', 'tonHour', 'literMinute', 1), RangeError);
});
