import test from 'ava';

import { blockLine, evaluate, extract } from '../extract';

/** What a monitor pulls out of a page, an API response or a command's output. */

test('a shop page gives its JSON-LD price, not the first dollar amount', t => {
  const html = `<html><body><div>Save $50 today!</div>
    <script type="application/ld+json">{"@type":"Product","offers":{"price":"1,899.99"}}</script>
    </body></html>`;
  t.is(extract(html, { type: 'number' }), '1899.99');
});

test('without JSON-LD, the first currency amount in the visible text', t => {
  const html = '<p>RTX 5090 Founders Edition</p><span class="price">$1,999.00</span>';
  t.is(extract(html, { type: 'number' }), '1999.00');
});

test('plain command output gives its first number', t => {
  t.is(extract('rows: 1,204\n', { type: 'number' }), '1204');
  t.is(extract('-3.5 degrees', { type: 'number' }), '-3.5');
});

test('a regex takes its first capture group from the page text', t => {
  const html = '<td>30-year fixed</td><td>6.42%</td>';
  t.is(extract(html, { type: 'regex', pattern: 'fixed\\s+([\\d.]+)%' }), '6.42');
});

test('a JSON path reads into an API response', t => {
  const body = JSON.stringify({ rates: { EUR: 0.9213 }, list: [{ v: 'a' }] });
  t.is(extract(body, { type: 'jsonpath', pattern: 'rates.EUR' }), '0.9213');
  t.is(extract(body, { type: 'jsonpath', pattern: '$.list[0].v' }), 'a');
});

test('a value that isn’t there fails with what to fix', t => {
  t.throws(() => extract('no digits here', { type: 'number' }), { message: /No number/ });
  t.throws(() => extract('{}', { type: 'jsonpath', pattern: 'rates.EUR' }), {
    message: /Nothing at rates.EUR/,
  });
  t.throws(() => extract('<html>', { type: 'jsonpath', pattern: 'a' }), { message: /not JSON/ });
  t.throws(() => extract('x', { type: 'regex', pattern: '(' }), { message: /Not a valid regex/ });
});

test('text is trimmed and capped', t => {
  t.is(extract('  hello  ', { type: 'text' }), 'hello');
  t.is(extract('x'.repeat(2000), { type: 'text' }).length, 500);
});

test('change alerts only when the value actually changed', t => {
  t.false(evaluate({ type: 'change' }, '5', null).alert, 'the first reading is not a change');
  t.false(evaluate({ type: 'change' }, '5', '5').alert);
  t.deepEqual(evaluate({ type: 'change' }, '6', '5'), { alert: true, reason: 'changed' });
});

test('a threshold alerts when it is crossed, not on every reading past it', t => {
  const below = { type: 'below' as const, value: 1900 };
  t.true(evaluate(below, '1899', '1999').alert);
  t.true(evaluate(below, '1899', null).alert, 'already past it on the first reading');
  t.false(evaluate(below, '1850', '1899').alert, 'still below: no repeat');
  t.false(evaluate(below, '1950', '1899').alert);
  t.is(evaluate({ type: 'above', value: 6 }, '6.42', '5.9').reason, 'above 6');
});

test('the block line says the value, when, and which way it moved', t => {
  const at = new Date('2026-10-05T14:30:00Z');
  t.is(blockLine('EUR', '0.92', '0.91', at), 'EUR: 0.92 · checked 2026-10-05 14:30 UTC · ↑ from 0.91');
  t.is(blockLine('EUR', '0.92', null, at), 'EUR: 0.92 · checked 2026-10-05 14:30 UTC');
  t.is(blockLine('Status', 'up', 'down', at), 'Status: up · checked 2026-10-05 14:30 UTC · changed');
});
