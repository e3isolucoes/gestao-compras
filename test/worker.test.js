import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { compareSensitivityResults, evaluateCandidates, formulateProcurementModel, generateSearchQueries, normalizeAttributes, structureRequirements } from '../src/worker.js';

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

test('maps equivalent attribute names without changing source values', () => {
  const attributes = { 'Memória RAM': 16, peso_kg: 1.5, cor: 'preto' };
  assert.deepEqual(normalizeAttributes({
    attributes,
    schema: { properties: { memoria_ram: { type: 'number' }, weight: { type: 'number' } } },
    known_synonyms: { weight: ['peso', 'peso_kg'] }
  }), {
    mapping: [
      { source_field: 'Memória RAM', target_field: 'memoria_ram', confidence: 1 },
      { source_field: 'peso_kg', target_field: 'weight', confidence: 0.95 }
    ],
    unmapped_fields: ['cor']
  });
  assert.deepEqual(attributes, { 'Memória RAM': 16, peso_kg: 1.5, cor: 'preto' });
});

test('attribute mapping endpoint accepts synonym pairs and rejects invalid JSON', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/attribute-mappings', {
    method: 'POST',
    body: JSON.stringify({
      attributes: ['voltagem', 'quantidade'],
      schema: ['voltage'],
      known_synonyms: [{ source_field: 'voltagem', target_field: 'voltage' }]
    })
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    mapping: [{ source_field: 'voltagem', target_field: 'voltage', confidence: 0.95 }],
    unmapped_fields: ['quantidade']
  });

  const invalid = await worker.fetch(new Request('https://example.com/api/attribute-mappings', {
    method: 'POST', body: '{'
  }), environment());
  assert.equal(invalid.status, 400);
});

test('evaluates only candidate attributes marked as uncertain', () => {
  assert.deepEqual(evaluateCandidates({
    mandatory_requirements: [
      { attribute: 'memória RAM', operator: '>=', value: 16, unit: 'GB' },
      { attribute: 'sistema operacional', operator: '=', value: 'Linux' }
    ],
    top_candidates: [
      {
        candidate_id: 'produto-1',
        uncertain_attributes: ['memória RAM'],
        specifications: { 'Memória RAM': '8 GB', 'sistema operacional': 'Linux' }
      },
      {
        id: 2,
        uncertain_attributes: ['memória RAM'],
        attributes: {}
      }
    ]
  }), {
    evaluations: [
      {
        candidate_id: 'produto-1',
        mandatory_fit: false,
        technical_score: 0,
        uncertain_attributes: [],
        rejection_reasons: ['memória RAM: valor informado não atende a >= 16 GB.']
      },
      {
        candidate_id: '2',
        mandatory_fit: true,
        technical_score: 0,
        uncertain_attributes: ['memória RAM'],
        rejection_reasons: []
      }
    ]
  });
});

test('candidate evaluation endpoint returns the stable output contract', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/candidate-evaluations', {
    method: 'POST',
    body: JSON.stringify({
      requirements: { mandatory_requirements: [{ attribute: 'voltagem', operator: '=', value: 220, unit: 'V' }] },
      candidates: [{ candidate_id: 'a', technical_attributes: { voltagem: '220 V' } }]
    })
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    evaluations: [{
      candidate_id: 'a', mandatory_fit: true, technical_score: 100,
      uncertain_attributes: [], rejection_reasons: []
    }]
  });
});

test('formulates a procurement MILP with MCDA criteria without solving it', () => {
  const model = formulateProcurementModel({
    requirements: { quantity: 20, budget_limit: 120000 },
    valid_candidates: [
      { id: 'a', unit_cost: 5000, capacity: 20 },
      { id: 'b', unit_cost: 4800, capacity: 12 }
    ],
    business_rules: [{ id: 'one_supplier', type: 'cardinality', expression: 'sum_i(x_i) = 1' }],
    criteria: [
      { name: 'cost', direction: 'min', weight: 0.6 },
      { name: 'quality', direction: 'max', weight: 0.4 }
    ]
  });

  assert.equal(model.model_type, 'MCDA_PLUS_MILP');
  assert.equal(model.objective.direction, 'min');
  assert.deepEqual(model.decision_variables.map(variable => variable.name), ['x_i', 'q_i']);
  assert.deepEqual(model.constraints.map(constraint => constraint.id), ['demand', 'budget', 'selection_link', 'one_supplier']);
  assert.deepEqual(model.criteria, [
    { name: 'cost', direction: 'min', weight: 0.6 },
    { name: 'quality', direction: 'max', weight: 0.4 }
  ]);
  assert.deepEqual(model.missing_parameters, []);
  assert.equal('solution' in model, false);
});

test('mathematical model endpoint reports missing symbolic parameters', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/mathematical-models', {
    method: 'POST',
    body: JSON.stringify({ requirements: {}, valid_candidates: [], business_rules: [] })
  }), environment());
  const model = await response.json();
  assert.equal(response.status, 200);
  assert.equal(model.model_type, 'LP');
  assert.deepEqual(model.missing_parameters, [
    'valid_candidates', 'required_quantity_or_selection_cardinality', 'candidate_costs'
  ]);

  const invalid = await worker.fetch(new Request('https://example.com/api/mathematical-models', {
    method: 'POST', body: '{'
  }), environment());
  assert.equal(invalid.status, 400);
});

test('compares supplied sensitivity winners without calculating new scores', () => {
  const comparison = compareSensitivityResults({ solver_sensitivity_results: {
    economic: { winner: 'Fornecedor A', critical_variables: ['preço'] },
    balanced: { selected_alternative: 'Fornecedor A', critical_variables: ['prazo'] },
    performance: { recommended_alternative: 'Fornecedor A' },
    low_risk: { best_candidate: 'Fornecedor A', sensitive_variables: ['prazo'] }
  } });
  assert.deepEqual(comparison.winner_by_scenario, {
    economic: 'Fornecedor A', balanced: 'Fornecedor A', performance: 'Fornecedor A', low_risk: 'Fornecedor A'
  });
  assert.equal(comparison.stable_winner, true);
  assert.equal(comparison.decision_sensitivity, 'LOW');
  assert.deepEqual(comparison.critical_variables, ['preço', 'prazo']);
  assert.ok(comparison.summary.split(/\s+/).length <= 60);
});

test('sensitivity comparison endpoint reports changing and missing winners', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/sensitivity-comparisons', {
    method: 'POST',
    body: JSON.stringify({ scenarios: [
      { scenario: 'economic', winner: 'A' },
      { scenario: 'balanced', winner: 'B' },
      { scenario: 'performance', winner: 'C' }
    ] })
  }), environment());
  const comparison = await response.json();
  assert.equal(response.status, 200);
  assert.equal(comparison.stable_winner, false);
  assert.equal(comparison.decision_sensitivity, 'HIGH');
  assert.equal(comparison.winner_by_scenario.low_risk, '');
});
