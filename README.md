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

3. Copie o `database_id` retornado para `wrangler.jsonc`, substituindo `SUBSTITUA_PELO_DATABASE_ID`.
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
