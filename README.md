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
