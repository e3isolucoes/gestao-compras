import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function environment() {
  const rows = [];
  return {
    rows,
    DB: {
      prepare(sql) {
        return {
          bind(...values) { return { async run() { rows.push({ sql, values }); console.log('DB INSERT:', JSON.stringify({ sql, values }, null, 2)); } }; },
          async first() { return { 1: 1 }; }
        };
      }
    },
    ASSETS: { fetch: async () => new Response('asset') }
  };
}

test('persists a valid analysis in D1', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://example.com/api/analyses', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'Comprar notebooks', quantity: '20' })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.saved, true);
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.equal(env.rows[0].values[1], 'Comprar notebooks');
  assert.equal(env.rows[0].values[5], '20');
});

test('persists multicriteria decision inputs', async () => {
  const env = environment();
  const criteria = '[{"id":"price","weight":100}]';
  const alternatives = '[{"name":"A","price":10}]';
  const response = await worker.fetch(new Request('https://example.com/api/analyses', {
    method: 'POST', body: JSON.stringify({ description: 'Comprar item', criteria, alternatives })
  }), env);
  assert.equal(response.status, 201);
  assert.equal(env.rows[0].values[8], criteria);
  assert.equal(env.rows[0].values[9], alternatives);
});

test('rejects an empty description', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/analyses', {
    method: 'POST', body: JSON.stringify({ description: '  ' })
  }), environment());
  assert.equal(response.status, 422);
});

test('serves static assets outside the API', async () => {
  const response = await worker.fetch(new Request('https://example.com/'), environment());
  assert.equal(await response.text(), 'asset');
});
