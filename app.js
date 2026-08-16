const examples = {
  notebooks: 'Preciso comprar 20 notebooks para a equipe de engenharia, com 16 GB de RAM, SSD de 512 GB, garantia de 3 anos, entrega em até 15 dias e orçamento máximo de R$ 120 mil.',
  energia: 'Precisamos contratar um gerador de energia para uma unidade industrial, com capacidade mínima de 500 kVA, instalação e manutenção inclusas e operação em até 60 dias.',
  frota: 'Quero comparar compra e locação de 12 veículos para a equipe comercial, considerando combustível, manutenção, seguro, prazo de entrega e custo total em 36 meses.'
};

const need = document.querySelector('#need');
const results = document.querySelector('#results');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2400);
}

document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  need.value = examples[button.dataset.example];
  need.focus();
}));

document.querySelector('#attachBtn').addEventListener('click', () => document.querySelector('#fileInput').click());
document.querySelector('#fileInput').addEventListener('change', event => {
  if (event.target.files[0]) showToast(`${event.target.files[0].name} anexado`);
});

document.querySelector('#analysisForm').addEventListener('submit', event => {
  event.preventDefault();
  const description = need.value.trim();
  if (!description) return;
  document.querySelector('#objective').textContent = description;
  results.hidden = false;
  document.body.style.overflow = 'hidden';
});

document.querySelector('#closeResults').addEventListener('click', () => {
  results.hidden = true;
  document.body.style.overflow = '';
});

document.querySelector('#historyBtn').addEventListener('click', () => showToast('Seu histórico aparecerá aqui após a primeira análise.'));
