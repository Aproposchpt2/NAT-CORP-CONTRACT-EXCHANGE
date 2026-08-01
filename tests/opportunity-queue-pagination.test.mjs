import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const queue = fs.readFileSync(new URL('../netlify/functions/opportunity-queue.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../netlify/functions/opportunity-fulfillment-page.mjs', import.meta.url), 'utf8');

test('OTF queue exposes deterministic 60-record pagination metadata', () => {
  assert.match(queue, /page_size/);
  assert.match(queue, /has_next/);
  assert.match(queue, /has_previous/);
  assert.match(queue, /rows\.slice\(offset, offset \+ pageSize\)/);
});

test('OTF operator page exposes Next 60 and Previous 60 controls', () => {
  assert.match(page, /Next 60/);
  assert.match(page, /Previous 60/);
  assert.match(page, /queuePage \+= 1/);
  assert.match(page, /queuePage = Math\.max\(1, queuePage - 1\)/);
});
