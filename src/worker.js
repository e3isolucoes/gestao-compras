const FIELDS = ['description', 'budget', 'deadline', 'location', 'quantity', 'preferences', 'constraints', 'criteria', 'alternatives'];
const MAX_LENGTH = 5000;

const REQUIREMENT_FIELDS = ['quantity', 'unit', 'location', 'deadline', 'budget_limit'];
const MAX_SEARCH_QUERIES = 5;
const SENSITIVITY_SCENARIOS = ['economic', 'balanced', 'performance', 'low_risk'];

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

function recordList(value) {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) =>
    item && typeof item === 'object' && !Array.isArray(item) ? { id, ...item } : { id, value: item }
  );
  return [];
}

function hasText(value, pattern) {
  try { return pattern.test(JSON.stringify(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()); }
  catch { return false; }
}

function criterionList(input) {
  const sources = [input.criteria, input.requirements?.criteria, input.business_rules?.criteria];
  return recordList(sources.find(Array.isArray) ?? []).flatMap((criterion, index) => {
    const name = textValue(criterion.name ?? criterion.nome ?? criterion.id) || `criterion_${index + 1}`;
    const rawDirection = textValue(criterion.direction ?? criterion.direcao).toLowerCase();
    const direction = /max|maior|benef/.test(rawDirection) ? 'max' : 'min';
    const rawWeight = criterion.weight ?? criterion.peso;
    return [{ name, direction, weight: typeof rawWeight === 'number' ? rawWeight : null }];
  });
}

/** Builds a symbolic model only; it deliberately neither estimates parameters nor solves it. */
export function formulateProcurementModel(input = {}) {
  const requirements = input.requirements && typeof input.requirements === 'object' && !Array.isArray(input.requirements)
    ? input.requirements : {};
  const candidates = recordList(input.valid_candidates ?? input.candidates);
  const rules = Array.isArray(input.business_rules) ? input.business_rules : recordList(input.business_rules);
  const criteria = criterionList(input);
  const corpus = { requirements, candidates, rules };
  const hasQuantity = requirements.quantity !== undefined && requirements.quantity !== null && requirements.quantity !== '';
  const hasBudget = requirements.budget_limit !== undefined || requirements.budget !== undefined;
  const hasCapacity = candidates.some(candidate => candidate.capacity !== undefined || candidate.max_quantity !== undefined);
  const transportation = hasText(corpus, /origin|origem/) && hasText(corpus, /destination|destino/);
  const assignment = !transportation && hasText(corpus, /assignment|alocacao|designacao/) && hasText(corpus, /recurso|resource|fornecedor/);
  const explicitMultiobjective = hasText(requirements, /multiobjective|multiobjetivo|pareto/);
  const discrete = candidates.length > 0 || hasText(corpus, /binary|binari|integer|inteir|selecion/);
  const mixed = discrete && (hasQuantity || hasCapacity || hasText(corpus, /continuous|continu/));
  let model_type = 'LP';
  if (transportation) model_type = 'TRANSPORTATION';
  else if (assignment) model_type = 'ASSIGNMENT';
  else if (criteria.length && discrete) model_type = 'MCDA_PLUS_MILP';
  else if (criteria.length) model_type = 'MCDA';
  else if (explicitMultiobjective) model_type = 'MULTIOBJECTIVE';
  else if (discrete && hasBudget && !hasQuantity && !hasCapacity) model_type = 'KNAPSACK';
  else if (mixed) model_type = 'MILP';
  else if (discrete) model_type = 'INTEGER';

  const decision_variables = [];
  if (transportation) {
    decision_variables.push({ name: 'q_o,d', domain: 'continuous_nonnegative', description: 'Quantidade enviada da origem o ao destino d.' });
  } else {
    if (candidates.length || discrete) decision_variables.push({ name: 'x_i', domain: 'binary', description: '1 se o candidato i for selecionado; 0 caso contrário.' });
    if (hasQuantity || hasCapacity) decision_variables.push({ name: 'q_i', domain: hasText(requirements, /indivis|integer|inteir/) ? 'integer_nonnegative' : 'continuous_nonnegative', description: 'Quantidade adquirida do candidato i.' });
  }

  const constraints = [];
  if (hasQuantity) constraints.push({ id: 'demand', type: 'demand_fulfillment', expression_template: 'sum_i(q_i) >= Q_required', parameters: { Q_required: requirements.quantity } });
  if (hasBudget) constraints.push({ id: 'budget', type: 'budget_limit', expression_template: 'sum_i(unit_cost_i * q_i + fixed_cost_i * x_i) <= B_max', parameters: { B_max: requirements.budget_limit ?? requirements.budget } });
  if (candidates.length && !transportation) constraints.push({ id: 'selection_link', type: 'variable_linking', expression_template: '0 <= q_i <= capacity_i * x_i, for all i in I', parameters: { candidate_set: candidates.map((candidate, index) => candidate.id ?? candidate.candidate_id ?? `candidate_${index + 1}`) } });
  if (transportation) constraints.push(
    { id: 'origin_capacity', type: 'capacity', expression_template: 'sum_d(q_o,d) <= supply_o, for all o in O', parameters: {} },
    { id: 'destination_demand', type: 'demand_fulfillment', expression_template: 'sum_o(q_o,d) >= demand_d, for all d in D', parameters: {} }
  );
  rules.forEach((rule, index) => constraints.push({
    id: textValue(rule.id) || `business_rule_${index + 1}`,
    type: textValue(rule.type) || 'business_rule',
    expression_template: textValue(rule.expression_template ?? rule.expression) || `formalize(business_rule_${index + 1})`,
    parameters: rule.parameters && typeof rule.parameters === 'object' ? rule.parameters : { source_rule: rule }
  }));

  const missing = [];
  if (!candidates.length) missing.push('valid_candidates');
  if (!hasQuantity && !assignment) missing.push('required_quantity_or_selection_cardinality');
  if (!candidates.length || !candidates.every(candidate => candidate.unit_cost !== undefined || candidate.cost !== undefined || candidate.price !== undefined)) missing.push('candidate_costs');
  if ((hasQuantity || hasCapacity) && !candidates.every(candidate => candidate.capacity !== undefined || candidate.max_quantity !== undefined)) missing.push('candidate_capacities');
  if (criteria.some(criterion => criterion.weight === null)) missing.push('criteria_weights');
  if (transportation) missing.push('origin_supply', 'destination_demand', 'route_costs');

  const components = [{ name: 'total_cost', expression_template: transportation ? 'sum_o,d(route_cost_o,d * q_o,d)' : 'sum_i(unit_cost_i * q_i + fixed_cost_i * x_i)', weight: criteria.length ? null : 1 }];
  criteria.forEach(criterion => components.push({ name: criterion.name, expression_template: `aggregate_${criterion.name}(x_i, q_i)`, weight: criterion.weight }));
  return {
    model_type,
    objective: { direction: criteria.some(criterion => criterion.direction === 'max') && !criteria.some(criterion => criterion.direction === 'min') ? 'max' : 'min', components },
    decision_variables,
    constraints,
    criteria,
    solver_recommendation: model_type === 'MCDA' ? 'Motor MCDA (por exemplo, weighted sum ou TOPSIS), após definição de pesos e normalização.' : model_type === 'LP' ? 'Solver de programação linear.' : model_type === 'TRANSPORTATION' ? 'Solver de fluxo de custo mínimo ou programação linear.' : 'Solver de programação inteira mista com suporte a variáveis binárias.',
    missing_parameters: [...new Set(missing)]
  };
}

function scenarioResult(results, scenario) {
  if (Array.isArray(results)) {
    return results.find(item => item && comparableField(item.scenario ?? item.name ?? item.id) === comparableField(scenario)) ?? {};
  }
  return results && typeof results === 'object' && !Array.isArray(results) ? results[scenario] ?? {} : {};
}

function scenarioWinner(result) {
  if (typeof result === 'string' || typeof result === 'number') return textValue(String(result));
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const value = result.winner ?? result.winning_alternative ?? result.selected_alternative
    ?? result.recommended_alternative ?? result.best_candidate ?? result.candidate_id;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return textValue(String(value.name ?? value.id ?? value.candidate_id ?? ''));
  }
  return value === undefined || value === null ? '' : textValue(String(value));
}

/** Compares solver outputs already supplied; it never reruns or derives scenario scores. */
export function compareSensitivityResults(input = {}) {
  const results = input.solver_sensitivity_results ?? input.scenarios ?? input;
  const winner_by_scenario = Object.fromEntries(SENSITIVITY_SCENARIOS.map(scenario => [
    scenario, scenarioWinner(scenarioResult(results, scenario))
  ]));
  const supplied = Object.values(winner_by_scenario).filter(Boolean);
  const uniqueWinners = new Set(supplied.map(comparableField));
  const stable_winner = supplied.length === SENSITIVITY_SCENARIOS.length && uniqueWinners.size === 1;
  const critical_variables = [...new Set(SENSITIVITY_SCENARIOS.flatMap(scenario => {
    const result = scenarioResult(results, scenario);
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    return stringList(result.critical_variables ?? result.sensitive_variables ?? result.binding_variables);
  }))];
  const decision_sensitivity = stable_winner ? 'LOW' : uniqueWinners.size <= 2 && supplied.length === SENSITIVITY_SCENARIOS.length ? 'MEDIUM' : 'HIGH';
  const fullSummary = stable_winner
    ? `${supplied[0]} vence nos quatro cenários; a decisão é estável. Variáveis críticas informadas: ${critical_variables.length ? critical_variables.join(', ') : 'nenhuma'}.`
    : `${uniqueWinners.size || 'Nenhum'} vencedor(es) distinto(s) nos cenários informados; sensibilidade ${decision_sensitivity}. Variáveis críticas informadas: ${critical_variables.length ? critical_variables.join(', ') : 'nenhuma'}.`;
  const summaryWords = fullSummary.split(/\s+/);
  const summary = summaryWords.length <= 60 ? fullSummary : `${summaryWords.slice(0, 59).join(' ')}…`;

  return { stable_winner, winner_by_scenario, critical_variables, decision_sensitivity, summary };
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

async function createMathematicalModel(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(formulateProcurementModel(input));
}

async function createSensitivityComparison(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Envie um objeto JSON.' }, { status: 400 });
  }
  return json(compareSensitivityResults(input));
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
  if (pathname === '/api/mathematical-models' && request.method === 'POST') return createMathematicalModel(request);
  if (pathname === '/api/sensitivity-comparisons' && request.method === 'POST') return createSensitivityComparison(request);
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
