# Deploy & Migração — criteria_json e alternatives_json

Resumo
- As mudanças do PR #4 foram integradas diretamente na branch `main`.
- Commits relevantes:
  - 8d5b56c — migrations/0002_add_decision_data.sql (adiciona criteria_json e alternatives_json)
    https://github.com/e3isolucoes/gestao-compras/commit/8d5b56c0954fe9d174490d4dd292759552c60dd0
  - 220ac3d — public/app.js (integração da UI de classificação multicritério)
    https://github.com/e3isolucoes/gestao-compras/commit/220ac3d5f758d72525e88bd2e97be2335d42a564
  - 93f98d4 — public/index.html (campos para criteria/alternatives e textos atualizados)
    https://github.com/e3isolucoes/gestao-compras/commit/93f98d4309ae00b6d5af7f17081cdcb7b047e763
  - 9f5a485 — public/styles.css, src/worker.js, test/worker.test.js (estilos, persistência e testes)
    https://github.com/e3isolucoes/gestao-compras/commit/9f5a4850aa196815605cc6ba7291b1f00a42cc0e

Objetivo
- Aplicar a migração que adiciona as colunas `criteria_json` e `alternatives_json` na tabela `analyses`.
- Rodar testes e validar frontend e backend em staging antes de promover para produção.

Migração (SQL)
Execute uma vez em cada ambiente (dev → staging → prod). Faça BACKUP da tabela `analyses` antes.

```sql
ALTER TABLE analyses ADD COLUMN criteria_json TEXT;
ALTER TABLE analyses ADD COLUMN alternatives_json TEXT;
```

Checklist de deploy
- [ ] Fazer backup da base de dados (tabela `analyses` ou dump completo).
- [ ] Aplicar a migration em staging.
- [ ] Executar os testes automatizados (CI): `npm test` ou comando de testes do projeto.
- [ ] Testar a API manualmente em staging:
  - POST /api/analyses com payload contendo `criteria` e `alternatives` (strings JSON).
  - Verificar que `criteria_json` e `alternatives_json` foram gravados na tabela `analyses`.
- [ ] Testar o frontend em staging:
  - Acessar a página principal, usar `Preencher exemplo` e submeter.
  - Confirmar que o relatório (ranking, métricas, TCO) é gerado corretamente.
- [ ] Revisar logs e métricas para erros inesperados.
- [ ] Aplicar a migration em produção em janela de manutenção.
- [ ] Reexecutar os testes de fumaça em produção.

Validações / comandos úteis
- Testes unitários/local:
  - `npm install`
  - `npm test`
- Teste manual via curl:
  ```bash
  curl -X POST 'https://<HOST>/api/analyses' \
    -H 'Content-Type: application/json' \
    -d '{"description":"Teste","criteria":"[{\"id\":\"price\",\"weight\":100}]","alternatives":"[{\"nome\":\"A\",\"preco\":10}]"}'
  ```
- Verifique entradas na tabela `analyses` (exemplo SQLite / D1):
  - `SELECT id, criteria_json, alternatives_json FROM analyses ORDER BY ROWID DESC LIMIT 5;`

Rollback (se necessário)
- Se algo falhar, você pode remover as colunas (perda de dados nas colunas novas):

```sql
ALTER TABLE analyses DROP COLUMN criteria_json; -- (alguns dbs não suportam DROP COLUMN)
ALTER TABLE analyses DROP COLUMN alternatives_json;
```

Obs: nem todos os bancos suportam `DROP COLUMN`. Se usar um banco que não suporta, restaurar do backup é o caminho seguro.

Notas finais
- O PR #4 ainda está aberto em: https://github.com/e3isolucoes/gestao-compras/pull/4
- Recomenda-se fechar o PR após confirmar que a integração em `main` está estável (já que o código foi aplicado diretamente). Se quiser, eu mesmo posso postar um comentário no PR informando que a integração foi feita e pedindo o fechamento — confirme se devo postar o comentário público no PR.

