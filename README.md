# OrçaFácil

Aplicação responsiva para estruturar necessidades de compras. A interface e a API rodam em um Cloudflare Worker, e cada análise é persistida em um banco Cloudflare D1.

## Desenvolvimento local

Requer Node.js 20 ou superior.

```bash
npm install
npx wrangler d1 migrations apply orcafacil-db --local
npm run dev
```

O Wrangler exibe o endereço local (normalmente `http://localhost:8787`). O modo local usa uma instância D1 persistida em `.wrangler/state`.

## Publicar na Cloudflare

1. Autentique o Wrangler:

   ```bash
   npx wrangler login
   ```

2. Crie o banco D1:

   ```bash
   npx wrangler d1 create orcafacil-db
   ```

3. Copie o `database_id` retornado para `wrangler.jsonc`. O banco deve pertencer à mesma
   conta Cloudflare conectada ao Worker `gestao-compras`; IDs de outra conta são rejeitados
   durante a publicação.
4. Aplique as migrações no banco remoto e publique:

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

5. Valide a implantação no endereço `*.workers.dev` informado:

   ```bash
   curl https://SEU-WORKER.workers.dev/api/health
   ```

Para automação em CI, defina `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` como segredos em vez de executar o login interativo.

## Estrutura

- `public/`: interface distribuída como Workers Static Assets.
- `src/worker.js`: API HTTP e integração com D1.
- `migrations/`: esquema versionado do banco.
- `wrangler.jsonc`: configuração da aplicação Cloudflare.

## Estruturação de requisitos

`POST /api/requirements` transforma os dados já extraídos em um contrato JSON previsível,
sem completar campos ausentes ou promover preferências a requisitos obrigatórios:

```json
{
  "user_request": "Comprar 20 notebooks",
  "predicted_category": "Equipamentos de TI",
  "entities": {
    "quantity": 20,
    "unit": "unidades",
    "preferences": ["baixo peso"],
    "mandatory_requirements": [
      { "attribute": "memória RAM", "operator": ">=", "value": 16, "unit": "GB" }
    ]
  }
}
```

O endpoint preserva valores explícitos, usa `null` ou listas vazias para dados ausentes e
só solicita esclarecimento quando a própria solicitação (`user_request`) não foi informada.

## Consultas para busca

`POST /api/search-queries` gera até cinco consultas curtas a partir de requisitos estruturados.
O endpoint prioriza os nomes comercial e técnico, sinônimos, categoria ou fabricante e acrescenta
somente características declaradas em `mandatory_requirements`. Consultas presentes em
`previous_queries` são removidas, e preferências não são usadas para restringir a busca:

```json
{
  "requirements": {
    "commercial_name": "notebook corporativo",
    "technical_name": "computador portátil",
    "synonyms": ["laptop empresarial"],
    "mandatory_requirements": [
      { "attribute": "memória RAM", "operator": ">=", "value": 16, "unit": "GB" }
    ]
  },
  "previous_queries": ["notebook 16 GB"],
  "result_count": 12
}
```

A resposta mantém sempre o contrato `{ "queries": [...] }`.

## Normalização de atributos

`POST /api/attribute-mappings` relaciona os campos recebidos ao schema mestre. O mapeamento
considera nomes equivalentes (ignorando caixa, acentos e separadores) e os sinônimos informados,
sem alterar valores numéricos nem converter unidades:

```json
{
  "attributes": { "Memória RAM": 16, "peso_kg": 1.5 },
  "schema": {
    "properties": {
      "memoria_ram": { "type": "number" },
      "weight": { "type": "number" }
    }
  },
  "known_synonyms": { "weight": ["peso", "peso_kg"] }
}
```

A resposta contém somente os campos mapeados, com sua confiança, e a lista de campos sem
correspondência no contrato `{ "mapping": [...], "unmapped_fields": [...] }`.

## Compatibilidade técnica de candidatos

`POST /api/candidate-evaluations` verifica requisitos obrigatórios apenas nos atributos que o
processo automático deixou em `uncertain_attributes`. Um valor inequivocamente incompatível
define `mandatory_fit` como `false`; quando não há evidência suficiente, o atributo permanece
na lista de incertezas sem provocar uma rejeição automática:

```json
{
  "mandatory_requirements": [
    { "attribute": "memória RAM", "operator": ">=", "value": 16, "unit": "GB" }
  ],
  "top_candidates": [
    {
      "candidate_id": "produto-1",
      "uncertain_attributes": ["memória RAM"],
      "specifications": { "memória RAM": "8 GB" }
    }
  ]
}
```

A resposta segue o contrato `{ "evaluations": [...] }`, incluindo pontuação de 0 a 100,
incertezas remanescentes e motivos objetivos de rejeição.

## Formulação matemática

`POST /api/mathematical-models` transforma requisitos, candidatos válidos e regras de negócio
em uma especificação simbólica para o motor matemático. O endpoint classifica o problema entre
LP, MILP, INTEGER, KNAPSACK, ASSIGNMENT, TRANSPORTATION, MULTIOBJECTIVE, MCDA e
MCDA_PLUS_MILP, mas não executa cálculos nem procura uma solução:

```json
{
  "requirements": { "quantity": 20, "budget_limit": 120000 },
  "valid_candidates": [
    { "id": "fornecedor-a", "unit_cost": 5000, "capacity": 20 }
  ],
  "business_rules": [
    { "id": "one_supplier", "type": "cardinality", "expression": "sum_i(x_i) = 1" }
  ],
  "criteria": [
    { "name": "cost", "direction": "min", "weight": 0.7 },
    { "name": "quality", "direction": "max", "weight": 0.3 }
  ]
}
```

A resposta contém apenas o tipo do modelo, objetivo, variáveis de decisão, restrições,
critérios, recomendação de solver e parâmetros ainda ausentes. Expressões são templates
simbólicos e valores não informados nunca são estimados.

## Comparação de sensibilidade

`POST /api/sensitivity-comparisons` compara os resultados já calculados para os cenários
`economic`, `balanced`, `performance` e `low_risk`. O endpoint apenas consolida vencedores e
variáveis críticas fornecidas: não recalcula pontuações nem executa o solver. A resposta informa
o vencedor de cada cenário, estabilidade, sensibilidade (`LOW`, `MEDIUM` ou `HIGH`) e um resumo
de até 60 palavras.
