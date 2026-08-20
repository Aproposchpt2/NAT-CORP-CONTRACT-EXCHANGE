import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// opportunity-fulfillment-page.mjs (a client-side-paginated, 60-record-batch
// wrapper) was intentionally removed in "Remove failing function route for
// OTF page" (923c18b) after "Emergency restore OTF route by redirecting to
// static operator page" (37dac23). The current operator page is the static
// opportunity-fulfillment.html, which drives pagination server-side (a
// `page`/`page_size` query param against the queue endpoint) in 30-record
// batches rather than client-side array slicing in 60-record batches.
const queue = fs.readFileSync(new URL('../netlify/functions/opportunity-queue.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../opportunity-fulfillment.html', import.meta.url), 'utf8');

test('OTF queue exposes deterministic pagination metadata', () => {
  assert.match(queue, /page_size/);
  assert.match(queue, /has_next/);
  assert.match(queue, /has_previous/);
  assert.match(queue, /rows\.slice\(offset, offset \+ pageSize\)/);
});

test('OTF operator page drives server-side 30-record pagination', () => {
  assert.match(page, /id="next"/);
  assert.match(page, /id="prev"/);
  assert.match(page, /page_size:'30'/);
});
