const FIELDS = ['description', 'budget', 'deadline', 'location', 'quantity', 'preferences', 'constraints', 'criteria', 'alternatives'];
const MAX_LENGTH = 5000;

const REQUIREMENT_FIELDS = ['quantity', 'unit', 'location', 'deadline', 'budget_limit'];
const MAX_SEARCH_QUERIES = 5;

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function normalize(input) {
  return Object.fromEntries(FIELDS.map(field => [field, typeof input[field] === 'string' ? input[field].trim() : '']));
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableValue(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value.trim() || null : value;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}

function fieldName(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return textValue(value.field ?? value.name ?? value.key ?? value.attribute);
}

function sourceFields(attributes) {
  if (Array.isArray(attributes)) return attributes.map(fieldName).filter(Boolean);
  if (!attributes || typeof attributes !== 'object') return [];
  return Object.keys(attributes).map(textValue).filter(Boolean);
}

function targetFields(schema) {
  if (Array.isArray(schema)) return schema.map(fieldName).filter(Boolean);
  if (!schema || typeof schema !== 'object') return [];
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    return Object.keys(schema.properties).map(textValue).filter(Boolean);
  }
  return Object.keys(schema).map(textValue).filter(Boolean);
}

function comparableField(value) {
  return textValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function synonymPairs(knownSynonyms) {
  if (Array.isArray(knownSynonyms)) {
    return knownSynonyms.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const target = fieldName(item.target_field ?? item.target ?? item.canonical);
      const sources = item.source_field ?? item.source ?? item.synonyms ?? item.aliases;
      const aliases = Array.isArray(sources) ? sources : [sources];
      return target ? aliases.map(fieldName).filter(Boolean).map(alias => [alias, target]) : [];
    });
  }
  if (!knownSynonyms || typeof knownSynonyms !== 'object') return [];
  return Object.entries(knownSynonyms).flatMap(([canonical, synonyms]) => {
    const aliases = Array.isArray(synonyms) ? synonyms : [synonyms];
    return aliases.map(fieldName).filter(Boolean).map(alias => [alias, canonical]);
  });
}

export function normalizeAttributes(input = {}) {
  const sources = sourceFields(input.attributes);
  const targets = targetFields(input.schema);
  const canonicalTargets = new Map(targets.map(target => [comparableField(target), target]));
  const aliases = new Map();

  for (const [alias, proposedTarget] of synonymPairs(input.known_synonyms)) {
    const target = canonicalTargets.get(comparableField(proposedTarget));
    if (target) aliases.set(comparableField(alias), target);
  }

  const mapping = [];
  const unmapped_fields = [];
  for (const source of sources) {
    const normalized = comparableField(source);
    const exactTarget = canonicalTargets.get(normalized);
    const synonymTarget = aliases.get(normalized);
    if (exactTarget || synonymTarget) {
      mapping.push({
        source_field: source,
        target_field: exactTarget ?? synonymTarget,
        confidence: exactTarget ? 1 : 0.95
      });
    } else {
      unmapped_fields.push(source);
    }
  }

  return { mapping, unmapped_fields };
}

function mandatoryRequirements(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const attribute = textValue(item.attribute);
    const operator = textValue(item.operator);
    if (!attribute || !operator || item.value === undefined || item.value === null || item.value === '') return [];
    return [{ attribute, operator, value: item.value, unit: nullableValue(item.unit) }];
  });
}

export function structureRequirements(input = {}) {
  const entities = input.entities && typeof input.entities === 'object' && !Array.isArray(input.entities)
    ? input.entities
    : {};
  const objective = textValue(input.user_request);
  const category = textValue(input.predicted_category);
  const missing = [];
  if (!objective) missing.push('objective');
  if (!category) missing.push('category');

  const result = {
    objective,
    category,
    ...Object.fromEntries(REQUIREMENT_FIELDS.map(field => [field, nullableValue(entities[field])])),
    mandatory_requirements: mandatoryRequirements(entities.mandatory_requirements),
    preferences: stringList(entities.preferences),
    constraints: stringList(entities.constraints),
    missing_critical_fields: missing,
    ambiguity_score: objective ? (category ? 0 : 0.2) : (category ? 0.8 : 1),
    needs_user_question: !objective,
    question: objective ? null : 'Qual é a solicitação que deve ser estruturada?'
  };

  return result;
}

function compactSearchTerm(value) {
  return textValue(value).replace(/\s+/g, ' ');
}

function searchTermList(value) {
  return stringList(value).map(compactSearchTerm);
}

function requirementSearchTerms(requirements) {
  if (typeof requirements === 'string') return [compactSearchTerm(requirements)].filter(Boolean);
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return [];

  const entities = requirements.entities && typeof requirements.entities === 'object' && !Array.isArray(requirements.entities)
    ? requirements.entities
    : requirements;
  const names = [
    requirements.commercial_name,
    entities.commercial_name,
    requirements.technical_name,
    entities.technical_name,
    requirements.product_name,
    entities.product_name,
    requirements.service_name,
    entities.service_name,
    requirements.objective,
    requirements.user_request,
    requirements.category,
    requirements.predicted_category,
    entities.manufacturer
  ].map(compactSearchTerm).filter(Boolean);
  const synonyms = [
    ...searchTermList(requirements.synonyms),
    ...searchTermList(entities.synonyms)
  ];
  const mandatory = mandatoryRequirements(
    requirements.mandatory_requirements ?? entities.mandatory_requirements
  ).map(item => compactSearchTerm(
    [item.attribute, item.operator, item.value, item.unit].filter(value => value !== null && value !== '').join(' ')
  ));

  const base = names[0] || synonyms[0] || '';
  const mandatorySuffix = mandatory.join(' ');
  return [
    ...names,
    ...synonyms,
    base && mandatorySuffix ? `${base} ${mandatorySuffix}` : '',
    ...names.slice(0, 2).map(name => mandatorySuffix ? `${name} ${mandatorySuffix}` : '')
  ].filter(Boolean);
}

export function generateSearchQueries(input = {}) {
  const previous = new Set(
    searchTermList(input.previous_queries).map(query => query.toLocaleLowerCase('pt-BR'))
  );
  const queries = [];

  for (const query of requirementSearchTerms(input.requirements)) {
    const normalized = query.toLocaleLowerCase('pt-BR');
    if (!previous.has(normalized) && !queries.some(item => item.toLocaleLowerCase('pt-BR') === normalized)) {
      queries.push(query);
    }
    if (queries.length === MAX_SEARCH_QUERIES) break;
  }

  return { queries };
}

function candidateAttributes(candidate) {
  const containers = [
    candidate.attributes,
    candidate.normalized_attributes,
    candidate.technical_attributes,
    candidate.specifications
  ];
  const attributes = new Map();
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const [name, value] of Object.entries(container)) {
      attributes.set(comparableField(name), value);
    }
  }
  return attributes;
}

function uncertainNames(candidate) {
  const value = candidate.uncertain_attributes ?? candidate.undetermined_attributes;
  if (!Array.isArray(value)) return null;
  return new Set(value.map(fieldName).filter(Boolean).map(comparableField));
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function satisfies(actual, requirement) {
  const rawOperator = textValue(requirement.operator).toLocaleLowerCase('pt-BR');
  const operator = comparableField(requirement.operator);
  const expected = requirement.value;
  const actualNumber = numericValue(actual);
  const expectedNumber = numericValue(expected);
  if (['>', '>=', '<', '<='].includes(rawOperator) && actualNumber !== null && expectedNumber !== null) {
    if (rawOperator === '>') return actualNumber > expectedNumber;
    if (rawOperator === '>=') return actualNumber >= expectedNumber;
    if (rawOperator === '<') return actualNumber < expectedNumber;
    return actualNumber <= expectedNumber;
  }
  const left = comparableField(String(actual));
  const right = comparableField(String(expected));
  if (['!=', '<>'].includes(rawOperator) || operator === 'diferente') return left !== right;
  if (['contem', 'contains', 'inclui'].includes(operator)) return left.includes(right);
  if (['nao contem', 'not contains', 'nao inclui'].includes(operator)) return !left.includes(right);
  if (['=', '=='].includes(rawOperator) || ['igual', 'equals', 'deve ser'].includes(operator)) {
    return actualNumber !== null && expectedNumber !== null ? actualNumber === expectedNumber : left === right;
  }
  return null;
}

export function evaluateCandidates(input = {}) {
  const requirements = mandatoryRequirements(
    input.mandatory_requirements ?? input.requirements?.mandatory_requirements
  );
  const candidates = Array.isArray(input.top_candidates)
    ? input.top_candidates
    : (Array.isArray(input.candidates) ? input.candidates : []);

  return {
    evaluations: candidates.map(candidate => {
      const candidateId = candidate?.candidate_id ?? candidate?.id ?? '';
      const attributes = candidate && typeof candidate === 'object' ? candidateAttributes(candidate) : new Map();
      const selected = candidate && typeof candidate === 'object' ? uncertainNames(candidate) : null;
      const relevant = selected === null
        ? requirements
        : requirements.filter(item => selected.has(comparableField(item.attribute)));
      const uncertain_attributes = [];
      const rejection_reasons = [];
      let satisfiedCount = 0;

      for (const requirement of relevant) {
        const key = comparableField(requirement.attribute);
        if (!attributes.has(key)) {
          uncertain_attributes.push(requirement.attribute);
          continue;
        }
        const result = satisfies(attributes.get(key), requirement);
        if (result === null) {
          uncertain_attributes.push(requirement.attribute);
        } else if (result) {
          satisfiedCount += 1;
        } else {
          rejection_reasons.push(
            `${requirement.attribute}: valor informado não atende a ${requirement.operator} ${requirement.value}${requirement.unit ? ` ${requirement.unit}` : ''}.`
          );
        }
      }

      const technical_score = relevant.length === 0
        ? 100
        : Math.round((satisfiedCount / relevant.length) * 100);
      return {
        candidate_id: String(candidateId),
        mandatory_fit: rejection_reasons.length === 0,
        technical_score,
        uncertain_attributes,
        rejection_reasons
      };
    })
  };
}

async function extractRequirements(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(structureRequirements(input));
}

async function createSearchQueries(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(generateSearchQueries(input));
}

async function createAttributeMapping(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(normalizeAttributes(input));
}

async function createCandidateEvaluations(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(evaluateCandidates(input));
}

async function createAnalysis(request, env) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }

  const data = normalize(input || {});
  if (!data.description) return json({ error: 'A solicitação é obrigatória.' }, { status: 422 });
  if (Object.values(data).some(value => value.length > MAX_LENGTH)) {
    return json({ error: `Cada campo deve ter no máximo ${MAX_LENGTH} caracteres.` }, { status: 422 });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO analyses (
      id, description, budget, deadline, location, quantity, preferences, constraints_text, criteria_json, alternatives_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    data.description,
    data.budget || null,
    data.deadline || null,
    data.location || null,
    data.quantity || null,
    data.preferences || null,
    data.constraints || null,
    data.criteria || null,
    data.alternatives || null
  ).run();

  return json({ id, saved: true }, { status: 201 });
}

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/health' && request.method === 'GET') {
    await env.DB.prepare('SELECT 1').first();
    return json({ ok: true });
  }
  if (pathname === '/api/requirements' && request.method === 'POST') return extractRequirements(request);
  if (pathname === '/api/search-queries' && request.method === 'POST') return createSearchQueries(request);
  if (pathname === '/api/attribute-mappings' && request.method === 'POST') return createAttributeMapping(request);
  if (pathname === '/api/candidate-evaluations' && request.method === 'POST') return createCandidateEvaluations(request);
  if (pathname === '/api/analyses' && request.method === 'POST') return createAnalysis(request, env);
  return json({ error: 'Rota não encontrada.' }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Request failed', error);
      return url.pathname.startsWith('/api/')
        ? json({ error: 'Não foi possível salvar a análise agora.' }, { status: 500 })
        : new Response('Erro interno', { status: 500 });
    }
  }
};
