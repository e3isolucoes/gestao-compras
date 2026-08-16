import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { generateSearchQueries, structureRequirements } from '../src/worker.js';

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

test('structures only supplied request data', () => {
  assert.deepEqual(structureRequirements({
    user_request: 'Comprar 20 notebooks',
    predicted_category: 'Equipamentos de TI',
    entities: {
      quantity: 20,
      unit: 'unidades',
      location: 'Recife',
      mandatory_requirements: [
        { attribute: 'memória RAM', operator: '>=', value: 16, unit: 'GB' }
      ],
      preferences: ['baixo peso'],
      constraints: ['mesmo modelo']
    }
  }), {
    objective: 'Comprar 20 notebooks',
    category: 'Equipamentos de TI',
    quantity: 20,
    unit: 'unidades',
    location: 'Recife',
    deadline: null,
    budget_limit: null,
    mandatory_requirements: [
      { attribute: 'memória RAM', operator: '>=', value: 16, unit: 'GB' }
    ],
    preferences: ['baixo peso'],
    constraints: ['mesmo modelo'],
    missing_critical_fields: [],
    ambiguity_score: 0,
    needs_user_question: false,
    question: null
  });
});

test('asks for the request when the critical objective is absent', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/requirements', {
    method: 'POST',
    body: JSON.stringify({ predicted_category: 'Serviços', entities: {} })
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    objective: '',
    category: 'Serviços',
    quantity: null,
    unit: null,
    location: null,
    deadline: null,
    budget_limit: null,
    mandatory_requirements: [],
    preferences: [],
    constraints: [],
    missing_critical_fields: ['objective'],
    ambiguity_score: 0.8,
    needs_user_question: true,
    question: 'Qual é a solicitação que deve ser estruturada?'
  });
});

test('rejects non-object requirement payloads', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/requirements', {
    method: 'POST', body: JSON.stringify([])
  }), environment());
  assert.equal(response.status, 400);
});

test('generates up to five short, distinct search queries', () => {
  assert.deepEqual(generateSearchQueries({
    requirements: {
      commercial_name: 'notebook corporativo',
      technical_name: 'computador portátil',
      predicted_category: 'equipamentos de TI',
      entities: {
        synonyms: ['laptop empresarial'],
        manufacturer: 'Dell',
        mandatory_requirements: [
          { attribute: 'memória RAM', operator: '>=', value: 16, unit: 'GB' }
        ],
        preferences: ['baixo peso']
      }
    },
    previous_queries: ['equipamentos de TI'],
    result_count: 0
  }), {
    queries: [
      'notebook corporativo',
      'computador portátil',
      'Dell',
      'laptop empresarial',
      'notebook corporativo memória RAM >= 16 GB'
    ]
  });
});

test('search query endpoint rejects invalid JSON and excludes prior queries', async () => {
  const invalid = await worker.fetch(new Request('https://example.com/api/search-queries', {
    method: 'POST', body: '{'
  }), environment());
  assert.equal(invalid.status, 400);

  const response = await worker.fetch(new Request('https://example.com/api/search-queries', {
    method: 'POST',
    body: JSON.stringify({
      requirements: 'serviço de manutenção de elevadores',
      previous_queries: ['serviço de manutenção de elevadores']
    })
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { queries: [] });
});
