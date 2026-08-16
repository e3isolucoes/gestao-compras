const FIELDS = ['description', 'budget', 'deadline', 'location', 'quantity', 'preferences', 'constraints', 'criteria', 'alternatives'];
const MAX_LENGTH = 5000;

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function normalize(input) {
  return Object.fromEntries(FIELDS.map(field => [field, typeof input[field] === 'string' ? input[field].trim() : '']));
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
