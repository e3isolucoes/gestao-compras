const $ = selector => document.querySelector(selector);
const fields = ['description', 'budget', 'deadline', 'location', 'quantity', 'preferences', 'constraints', 'criteria', 'alternatives'];
const labels = { budget: 'orçamento máximo', deadline: 'prazo máximo', location: 'local de entrega ou execução', quantity: 'quantidade', preferences: 'preferências', constraints: 'restrições adicionais' };

const examples = {
  description: 'Comprar notebooks para a equipe de engenharia, com 16 GB de RAM, SSD de 512 GB e garantia de 3 anos.',
  budget: 'R$ 120.000', deadline: '15 dias', location: 'Recife — PE', quantity: '20 unidades',
  preferences: 'baixo peso e assistência técnica local', constraints: 'todos os equipamentos devem ser do mesmo modelo',
  criteria: JSON.stringify([{ id: 'preco', nome: 'Preço', direcao: 'menor', peso: 30 }, { id: 'aderencia', nome: 'Aderência técnica', direcao: 'maior', peso: 25 }, { id: 'qualidade', nome: 'Qualidade', direcao: 'maior', peso: 20 }, { id: 'prazo', nome: 'Prazo', direcao: 'menor', peso: 15 }, { id: 'risco', nome: 'Risco', direcao: 'menor', peso: 10 }], null, 2),
  alternatives: JSON.stringify([{ nome: 'Fornecedor Alfa', viavel: true, preco: 108000, aderencia: 92, qualidade: 88, prazo: 14, risco: 8, custosAdicionais: 4000, probabilidadeRisco: 0.1, impactoRisco: 8000, valorResidual: 5000 }, { nome: 'Fornecedor Beta', viavel: true, preco: 99000, aderencia: 84, qualidade: 80, prazo: 18, risco: 15, custosAdicionais: 7500, probabilidadeRisco: 0.2, impactoRisco: 12000 }, { nome: 'Fornecedor Gama', viavel: false, motivoInviabilidade: 'Prazo excede a restrição obrigatória.', preco: 94000, aderencia: 87, qualidade: 85, prazo: 30, risco: 12 }], null, 2)
};

function value(id) { const el = $(`#${id}`); return el ? el.value.trim() : ''; }
function list(items) { return `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`; }
function card(title, content, wide = false) { return `<article class="output-card${wide ? ' wide' : ''}"><h3>${title}</h3>${content}</article>`; }
function escapeHtml(text) { const node = document.createElement('div'); node.textContent = text; return node.innerHTML; }
function showToast(message) { const t = $('#toast'); if (t) { t.textContent = message; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); } else { console.warn('Toast:', message); } }

function decisionReport(data) {
  if (!data || (!data.criteria && !data.alternatives)) return null;
  let criteria, alternatives;
  try {
    criteria = typeof data.criteria === 'string' ? JSON.parse(data.criteria) : data.criteria;
    alternatives = typeof data.alternatives === 'string' ? JSON.parse(data.alternatives) : data.alternatives;
  } catch (e) {
    throw new Error('Critérios e alternativas devem ser JSON válido.');
  }
  if (!Array.isArray(criteria) || !criteria.length || !Array.isArray(alternatives) || !alternatives.length) throw new Error('Informe listas não vazias de critérios e alternativas.');

  const viable = alternatives.filter(a => a.viavel !== false);
  const baseWeights = Object.fromEntries(criteria.map(c => [c.id, Number(c.peso ?? c.weight) || 0]));

  const score = (multipliers) => {
    const raw = Object.fromEntries(criteria.map(c => [c.id, baseWeights[c.id] * (multipliers && multipliers(c) ? 2 : 1)]));
    const total = Object.values(raw).reduce((a,b) => a + b, 0);
    if (!total) throw new Error('A soma dos pesos deve ser maior que zero.');

    return viable.map(a => {
      const notes = {};
      for (const c of criteria) {
        const values = viable.map(v => Number(v[c.id]));
        if (values.some(v => !Number.isFinite(v))) throw new Error(`Informe “${c.nome ?? c.id}” numericamente em todas as alternativas viáveis.`);
        const min = Math.min(...values), max = Math.max(...values), value = Number(a[c.id]);
        notes[c.id] = max === min ? 100 : (c.direcao === 'menor' ? (max - value) / (max - min) : (value - min) / (max - min)) * 100;
      }
      const value = criteria.reduce((sum, c) => sum + notes[c.id] * raw[c.id] / total, 0);
      return { a, notes, value };
    }).sort((x,y) => y.value - x.value);
  };

  const balanced = score(() => false);
  const economic = score(c => /preço|preco|custo/i.test((c.nome || c.id).toString()));
  const performance = score(c => /qualidade|aderencia|aderência|técnic|tecnic/i.test((c.nome || c.id).toString()));

  const ranked = balanced.map((row, i) => {
    const a = row.a;
    const prob = Number(a.probabilidadeRisco);
    const imp = Number(a.impactoRisco);
    const risk = Number.isFinite(prob) && Number.isFinite(imp) ? prob * imp : null;
    const tco = Number.isFinite(Number(a.preco)) ? Number(a.preco) + (Number(a.custosAdicionais) || 0) + (risk || 0) - (Number(a.valorResidual) || 0) : null;
    const audit = criteria.map(c => `${(c.peso ?? c.weight) || 0}% × ${row.notes[c.id].toFixed(1)}`).join(' + ');

    function money(n) { if (!Number.isFinite(Number(n))) return 'Não informado'; return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

    return card(`${i+1}º lugar — ${escapeHtml(a.nome)}`,
      `<p class="rank">Pontuação geral: ${row.value.toFixed(1)}/100</p><div class="metrics"><span><b>Preço</b>${money(a.preco)}</span><span><b>TCO</b>${money(tco)}</span><span><b>Aderência</b>${a.aderencia??'Não informada'}</span><span><b>Qualidade</b>${a.qualidade??'Não informada'}</span><span><b>Prazo</b>${a.prazo??'Não informado'}</span><span><b>Risco esperado</b>${risk===null?'Não calculável':money(risk)}</span></div><p><b>Cálculo:</b> ${audit} = ${row.value.toFixed(2)}.</p><p><b>Vantagens:</b> ${escapeHtml((a.vantagens||['Não informadas']).join('; '))}<br><b>Desvantagens:</b> ${escapeHtml((a.desvantagens||['Não informadas']).join('; '))}</p>`,true)}).join('');

  const invalid = alternatives.filter(a => a.viavel === false);
  const winners = [economic[0]?.a.nome, balanced[0]?.a.nome, performance[0]?.a.nome];
  const sensitive = new Set(winners.filter(Boolean)).size > 1;
  const tie = balanced[1] && (balanced[0].value - balanced[1].value) <= 3;

  const viableByPrice = viable.slice().sort((a,b) => Number(a.preco) - Number(b.preco));
  const viableByRisk = viable.slice().sort((a,b) => Number(a.risco) - Number(b.risco));

  return card('1 — Validação', alternatives.map(a => `<p><b>${escapeHtml(a.nome)}: ${a.viavel === false ? 'INVIÁVEL' : 'VIÁVEL'}.</b> ${a.viavel === false ? escapeHtml(a.motivoInviabilidade||'Motivo não informado.'):'Nenhuma violação foi declarada.'}</p>`).join(''),true)+card('2–6 — Método, normalização, risco e TCO','<p>Normalização min–max em 0–100, invertida para “menor é melhor”; empates recebem 100 para evitar divisão por zero. Aplicou-se análise multicritério ponderada. Não há dados de capacidades ou fluxos para programação linear, inteira/mista, knapsack, alocação ou transporte; AHP/TOPSIS exigiriam dados ou opção metodológica adicionais.</p><p>Risco financeiro = probabilidade × impacto. TCO = preço + custos adicionais + risco financeiro − valor residual. Componentes ausentes não foram estimados.</p>',true)+ranked+card('8 — Sensibilidade',`<div class="scenario-grid"><p class="scenario"><b>A — Econômico</b><br>${escapeHtml(winners[0]||'Sem opção viável')}</p><p class="scenario"><b>B — Equilibrado</b><br>${escapeHtml(winners[1]||'Sem opção viável')}</p><p class="scenario"><b>C — Performance</b><br>${escapeHtml(winners[2]||'Sem opção viável')}</p></div>${sensitive?'<p class="alert"><b>RESULTADO SENSÍVEL AOS PESOS.</b></p>':''}`,true)+card('9–10 — Recomendação e confiança',`<p><b>OPÇÃO RECOMENDADA / MELHOR CUSTO-BENEFÍCIO:</b> ${escapeHtml(winners[1]||'Indisponível')}<br><b>MENOR PREÇO:</b> ${escapeHtml(viableByPrice[0]?.nome||'Indisponível')}<br><b>MENOR RISCO:</b> ${escapeHtml(viableByRisk[0]?.nome||'Indisponível')}<br><b>MELHOR PERFORMANCE:</b> ${escapeHtml(winners[2]||'Indisponível')}</p>${tie?'<p class="alert"><b>EMPATE TÉCNICO.</b></p>':''}<p class="confidence">80%</p> Confiança baseada na completude numérica, sem validação externa. Evidências técnicas, composição integral do TCO, SLA e histórico dos fornecedores aumentariam a precisão.</p>${invalid.some(a=>!a.motivoInviabilidade)?'<p class="hypothesis"><b>DADO AUSENTE:</b> justifique toda inviabilidade.</p>':''}`,true);
}

function buildModel(data) {
  const present = id => data[id] ? escapeHtml(data[id]) : null;
  const mandatory = [];
  if (data.quantity) mandatory.push(`Atender à quantidade informada: ${present('quantity')}.`);
  if (data.budget) mandatory.push(`Não ultrapassar o orçamento máximo de ${present('budget')}.`);
  if (data.deadline) mandatory.push(`Cumprir o prazo máximo de ${present('deadline')}.`);
  if (data.location) mandatory.push(`Atender ao local informado: ${present('location')}.`);
  if (data.constraints) mandatory.push(`Respeitar as restrições adicionais: ${present('constraints')}.`);
  const missing = Object.keys(labels).filter(id => !data[id]).map(id => `Informar ${labels[id]}.`);
  missing.push('Obter preços, condições comerciais e especificações comparáveis das alternativas.', 'Definir como será comprovado o atendimento aos requisitos técnicos.');
  const desired = data.preferences ? [`Preferências declaradas: ${present('preferences')}.`] : ['Nenhum requisito desejável foi informado.'];
  const variables = ['xᵢ ∈ {0,1}: indica se a alternativa i é selecionada.', 'qᵢ ≥ 0: quantidade adquirida da alternativa i.', 'cᵢ: custo total calculado da alternativa i.'];
  const restrictions = [];
  if (data.budget) restrictions.push(`Σ(cᵢ × qᵢ) ≤ ${present('budget')}.`);
  if (data.quantity) restrictions.push(`Σqᵢ deve atender a ${present('quantity')}.`);
  if (data.deadline) restrictions.push(`Prazo da alternativa selecionada ≤ ${present('deadline')}.`);
  restrictions.push('xᵢ = 0 para toda alternativa que descumpra um requisito obrigatório.');
  const criteria = [
    ['Custo total', 'R$', 'Menor é melhor', '30%', 'Controla o impacto financeiro total da decisão.'],
    ['Aderência aos requisitos', '%', 'Maior é melhor', '30%', 'Mede o atendimento à necessidade declarada.'],
    ['Prazo', 'dias', 'Menor é melhor', '15%', 'Diferencia alternativas viáveis pelo tempo de atendimento.'],
    ['Qualidade técnica', 'pontuação 0–100', 'Maior é melhor', '15%', 'Compara desempenho e confiabilidade com evidências.'],
    ['Risco do fornecedor', 'pontuação 0–100', 'Menor é melhor', '10%', 'Reduz a exposição a atrasos e falhas de fornecimento.']
  ];
  const table = `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Unidade</th><th>Direção</th><th>Peso sugerido</th><th>Justificativa</th></tr></thead><tbody>${criteria.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td><td>${row[4]}</td></tr>`).join('')}</tbody></table></div>`;
  const feasibility = mandatory.length ? `Eliminar qualquer alternativa que exceda limites informados ou deixe de atender a um requisito obrigatório. ${mandatory.join(' ')}` : 'Eliminar qualquer alternativa que viole um requisito obrigatório.';

  return [
    card('Necessidade', `<p>${present('description')}${data.quantity ? ` Quantidade: ${present('quantity')}.` : ''}${data.location ? ` Local: ${present('location')}.` : ''}</p>`, true),
    card('Requisitos obrigatórios', mandatory.length ? list(mandatory) : '<p>Nenhum requisito obrigatório adicional foi informado.</p>'),
    card('Requisitos desejáveis', list(desired)), card('Dados ausentes', list(missing)), card('Variáveis de decisão', list(variables)),
    card('Função objetivo', '<p>Minimizar o custo total entre as alternativas viáveis e maximizar a aderência ponderada aos critérios de avaliação.</p><p class="hypothesis"><b>HIPÓTESE:</b> Os pesos declarados representam corretamente as prioridades da organização.</p>'),
    card('Restrições', list(restrictions), true), card('Critérios de avaliação', table, true),
    card('Método de otimização', '<p><b>Combinação de métodos:</b> programação inteira mista para selecionar quantidades sob orçamento e limites; weighted scoring para comparar os critérios quando não houver modelo de capacidade.</p>', true),
    card('Dados necessários para cálculo', list(['Preço unitário, impostos, frete e demais componentes do custo total.', 'Prazo e capacidade de fornecimento.', 'Especificações técnicas e evidências de performance.'])),
    card('Regra de viabilidade', `<p>${feasibility}</p>`),
    card('Nível de confiança', `<p><span class="confidence">BAIXA</span> Há uma descrição inicial, mas ainda não existem alternativas, cotações nem evidências de fornecedores para execução.</p>`)
  ].join('');
}

$('#analysisForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(fields.map(id => [id, value(id)]));
  const submitBtn = $('#submitBtn');
  submitBtn.disabled = true;
  if (submitBtn.firstChild) submitBtn.firstChild.textContent = 'Salvando... ';

  try {
    const response = await fetch('/api/analyses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a análise.');

    let reportHtml = null;
    try { reportHtml = decisionReport(data); } catch (err) { showToast(err.message || 'Erro na análise multicritério'); }

    $('#output').innerHTML = reportHtml || buildModel(data);
    $('#results').hidden = false;
    $('#results').dataset.analysisId = result.id;
    $('#results').scrollIntoView({ behavior: 'smooth' });
    showToast('Análise salva com segurança');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a análise.');
  } finally {
    submitBtn.disabled = false;
    if (submitBtn.firstChild) submitBtn.firstChild.textContent = 'Classificar alternativas ';
  }
});

$('#exampleBtn').addEventListener('click', () => { fields.forEach(id => { const el = $(`#${id}`); if (el) el.value = examples[id] || ''; }); });
$('#newBtn').addEventListener('click', () => { $('#results').hidden = true; $('#analysisForm').reset(); $('#entrada').scrollIntoView({ behavior: 'smooth' }); });
$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#output').innerText); showToast('Estrutura copiada'); }
  catch { showToast('Não foi possível copiar automaticamente'); }
});
