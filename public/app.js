const $ = selector => document.querySelector(selector);
const fields = ['description', 'budget', 'deadline', 'location', 'quantity', 'preferences', 'constraints'];
const labels = { budget: 'orçamento máximo', deadline: 'prazo máximo', location: 'local de entrega ou execução', quantity: 'quantidade', preferences: 'preferências', constraints: 'restrições adicionais' };

const examples = {
  description: 'Comprar notebooks para a equipe de engenharia, com 16 GB de RAM, SSD de 512 GB e garantia de 3 anos.',
  budget: 'R$ 120.000', deadline: '15 dias', location: 'Recife — PE', quantity: '20 unidades',
  preferences: 'baixo peso e assistência técnica local', constraints: 'todos os equipamentos devem ser do mesmo modelo'
};

function value(id) { return $(`#${id}`).value.trim(); }
function list(items) { return `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`; }
function card(title, content, wide = false) { return `<article class="output-card${wide ? ' wide' : ''}"><h3>${title}</h3>${content}</article>`; }
function escapeHtml(text) { const node = document.createElement('div'); node.textContent = text; return node.innerHTML; }
function showToast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 2200); }

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
  const table = `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Unidade</th><th>Direção</th><th>Peso sugerido</th><th>Justificativa</th></tr></thead><tbody>${criteria.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="hypothesis"><b>HIPÓTESE:</b> os pesos são uma sugestão inicial e devem ser validados pelo responsável pela compra.</p>`;
  const feasibility = mandatory.length ? `Eliminar qualquer alternativa que exceda limites informados ou deixe de atender a um requisito obrigatório. ${mandatory.join(' ')}` : 'Eliminar qualquer alternativa que não atenda à necessidade após os requisitos obrigatórios serem confirmados.';

  return [
    card('Necessidade', `<p>${present('description')}${data.quantity ? ` Quantidade: ${present('quantity')}.` : ''}${data.location ? ` Local: ${present('location')}.` : ''}</p>`, true),
    card('Requisitos obrigatórios', mandatory.length ? list(mandatory) : '<p>Nenhum requisito obrigatório adicional foi informado.</p>'),
    card('Requisitos desejáveis', list(desired)), card('Dados ausentes', list(missing)), card('Variáveis de decisão', list(variables)),
    card('Função objetivo', '<p>Minimizar o custo total entre as alternativas viáveis e maximizar a aderência ponderada aos critérios de avaliação.</p><p class="hypothesis"><b>HIPÓTESE:</b> custo e aderência são os objetivos prioritários; validar com o solicitante.</p>'),
    card('Restrições', list(restrictions), true), card('Critérios de avaliação', table, true),
    card('Método de otimização', '<p><b>Combinação de métodos:</b> programação inteira mista para selecionar quantidades sob orçamento e limites; weighted scoring para comparar os critérios qualitativos e quantitativos. A combinação permite primeiro garantir viabilidade e depois ordenar as opções.</p>', true),
    card('Dados necessários para cálculo', list(['Preço unitário, impostos, frete e demais componentes do custo total.', 'Prazo e capacidade de fornecimento.', 'Especificações técnicas e evidências de conformidade.', 'Garantia, suporte, manutenção e condições de pagamento.', 'Histórico de desempenho e risco dos fornecedores.'])),
    card('Regra de viabilidade', `<p>${feasibility}</p>`),
    card('Nível de confiança', `<p><span class="confidence">BAIXA</span> Há uma descrição inicial, mas ainda não existem alternativas, cotações nem evidências de fornecedores para executar o cálculo.</p>`, true)
  ].join('');
}

$('#analysisForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(fields.map(id => [id, value(id)]));
  const submitBtn = $('#submitBtn');
  submitBtn.disabled = true;
  submitBtn.firstChild.textContent = 'Salvando... ';

  try {
    const response = await fetch('/api/analyses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a análise.');

    $('#output').innerHTML = buildModel(data);
    $('#results').hidden = false;
    $('#results').dataset.analysisId = result.id;
    $('#results').scrollIntoView({ behavior: 'smooth' });
    showToast('Análise salva com segurança');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a análise.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.firstChild.textContent = 'Estruturar problema ';
  }
});

$('#exampleBtn').addEventListener('click', () => { fields.forEach(id => { $(`#${id}`).value = examples[id]; }); });
$('#newBtn').addEventListener('click', () => { $('#results').hidden = true; $('#analysisForm').reset(); $('#entrada').scrollIntoView({ behavior: 'smooth' }); });
$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#output').innerText); showToast('Estrutura copiada'); }
  catch { showToast('Não foi possível copiar automaticamente'); }
});
