# Monitor de Candidatos — API

API REST somente leitura sobre o schema público do Supabase (`candidato`,
`perfil_social`, `evento`, `metrica`). Node.js + TypeScript + Fastify +
`@supabase/supabase-js` (chave `anon`, nunca `service_role` — a API só faz
`SELECT`).

Ver [`../../projeto-monitor-candidatos.md`](../../projeto-monitor-candidatos.md)
para a arquitetura completa e [`../../db/migrations/0001_core_schema.sql`](../../db/migrations/0001_core_schema.sql)
para o schema exato.

## Como rodar

```bash
cd packages/api
npm install
cp .env.example .env   # já vem preenchido com a URL/anon key do projeto Supabase
npm run dev
```

O servidor sobe em `http://localhost:3333` por padrão (configurável via
`API_PORT`). `npm run build` compila para `dist/`; `npm start` roda o build
compilado.

Scripts disponíveis:

| Script | O que faz |
|---|---|
| `npm run dev` | `tsx watch` — hot reload em desenvolvimento |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda `dist/server.js` (usar depois do build) |
| `npm run typecheck` | `tsc --noEmit` |

## Variáveis de ambiente

Ver `.env.example`. As essenciais:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — projeto `mjojuycrkxidpkzyzuuz` (GLE TECH)
- `API_PORT` — porta HTTP (default `3333`)
- `API_CORS_ORIGIN` — origem extra liberada no CORS além de `http://localhost:5173`
  (útil para apontar para a URL do frontend em produção)

## Endpoints

Todas as respostas de erro seguem o formato `{ "error": "mensagem" }`.
Paginação (`limit`/`offset`) tem `limit` default 20 e máximo 100 por página.

### `GET /health`

Status simples, não depende do banco.

```json
{ "status": "ok", "service": "monitor-candidatos-api", "timestamp": "..." }
```

### `GET /dimensoes`

Estático — não depende do banco. Descreve as 9 dimensões de metrificação da
seção 6 do documento de arquitetura. Cada item tem `chave`, `nome`,
`descricao`, `fonte`.

**Convenção de chaves**: `chave` aqui é o *prefixo* usado em `metrica.chave`
no banco. Uma métrica concreta é `<dimensao>.<metrica>`, por exemplo
`producao_legislativa.taxa_aprovacao` ou `integridade.processos_transito_julgado`.
O frontend usa isso para agrupar métricas normalizadas por dimensão no painel
de pesos.

### `GET /candidatos`

Lista candidatos. Query params opcionais:

- `uf` — sigla da UF (exact match, case-insensitive)
- `cargo_pretendido` — exact match
- `partido_atual` — exact match
- `q` — busca por nome (usa o tsvector `busca` em português + fallback `ilike`)
- `limit`, `offset` — paginação

Retorna `{ data, limit, offset, total }` onde cada item de `data` tem `id`,
`nome_civil`, `nome_urna`, `partido_atual`, `uf`, `cargo_pretendido`,
`foto_url`.

### `GET /candidatos/:id`

Perfil completo: todas as colunas de `candidato` + `perfis_sociais` (array de
`perfil_social`). 404 se o `id` (uuid) não existir.

### `GET /candidatos/:id/eventos`

Timeline paginada, ordenada por `data_evento desc`. Query params opcionais:

- `tipo` — um de `proposicao|voto|processo|sancao|despesa|nomeacao|post|anuncio`
- `categoria` — um de `realizacao|controversia|neutro`
- `tema` — filtra eventos que contenham esse tema no array `tema`
- `limit`, `offset` — paginação

Cada evento traz todos os campos da tabela, incluindo `estagio_juridico` (nunca
colapsado — ver regra na seção 1 do documento de arquitetura), `fonte_nome` e
`fonte_url`. 404 se o candidato não existir.

Nota: eventos de `categoria = 'controversia'` só aparecem se
`revisado_humano = true` — isso é reforçado por RLS no Postgres, a API não
precisa filtrar de novo.

### `GET /candidatos/:id/metricas`

Métricas agregadas da tabela `metrica`, uma por `chave`, trazendo sempre o
registro com `calculado_em` mais recente (histórico completo por `periodo`
fica fora de escopo desta versão — a agregação por "mais recente" é feita em
memória na API, sem depender de `DISTINCT ON` via PostgREST). 404 se o
candidato não existir.

## Decisões de design

- **Chave anon, nunca service_role**: RLS no Postgres já expõe só o que é
  público (ver policies em `0001_core_schema.sql`); a API não duplica essa
  lógica de visibilidade.
- **Erros**: `ValidationError` → 400, `NotFoundError` → 404, qualquer outro
  erro não tratado → 500, sempre `{ error: string }`.
- **Paginação**: `limit` default 20, teto rígido de 100 (`MAX_PAGE_LIMIT` em
  `src/lib/pagination.ts`) para evitar payloads gigantes.
- **Busca por nome** (`q`): combina full-text search (`wfts`, dicionário
  `portuguese`, sobre a coluna gerada `busca`) com `ilike` como fallback, para
  cobrir tanto buscas por palavra completa quanto prefixos/trechos parciais.
- **Tipos manuais** (`src/types.ts`): não usamos `generate_typescript_types`
  do Supabase MCP — os tipos espelham manualmente o schema SQL, incluindo os
  literais estritos de `estagio_juridico`, `tipo`, `categoria`, etc.
