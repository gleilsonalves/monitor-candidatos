# Monitor de Candidatos

Plataforma de agregação e metrificação de dados públicos sobre candidatos a
cargos eletivos no Brasil (Presidente, Vice, Governador, Senador, Deputado
Federal). Ver [projeto-monitor-candidatos.md](./projeto-monitor-candidatos.md)
para a arquitetura completa e os princípios de design.

**Princípio central: o app não emite veredito.** Ele agrega fato verificável
com fonte linkada; o usuário define os pesos de cada dimensão no navegador e
o score é calculado inteiramente no cliente. Todo evento de `tipo='processo'`
carrega um `estagio_juridico` estritamente separado (denúncia ≠ réu ≠
condenado ≠ trânsito em julgado) — a UI nunca colapsa esses estados.

## Supabase

- Organização: **GLE TECH**
- Projeto: **monitor-candidatos** (`mjojuycrkxidpkzyzuuz`, região `sa-east-1`)
- Schema: `db/migrations/0001_core_schema.sql` — `candidato`, `candidato_alias`,
  `perfil_social`, `raw_payload`, `evento`, `metrica`, com RLS de leitura
  pública (eventos de `categoria='controversia'` só ficam públicos após
  `revisado_humano=true`) e CHECK constraint que obriga `estagio_juridico`
  somente quando `tipo='processo'`.

## Estrutura do monorepo

```
db/migrations/       migrations SQL (espelho do que foi aplicado no Supabase)
packages/api/        API REST — Node.js + Fastify
packages/workers/    Coletores por fonte oficial (framework + 9 adaptadores)
apps/web/            Frontend — React + Vite + Tailwind
```

Cada pacote tem seu próprio `README.md` com detalhes de setup, endpoints e
decisões de design. Os coletores em `packages/workers/src/collectors/*/`
também têm README próprio documentando o endpoint real usado, a estratégia
de entity resolution e as limitações conhecidas de cada fonte.

## Setup

1. Em cada pacote (`packages/api`, `packages/workers`, `apps/web`): copie
   `.env.example` para `.env` e `npm install`.
2. `packages/workers/.env` precisa da `SUPABASE_SERVICE_ROLE_KEY` (Supabase
   Dashboard → Project Settings → API → service_role) para gravar dados —
   sem ela, só o modo `--dry-run` dos coletores funciona. **Nunca** coloque
   essa chave em `apps/web` ou em qualquer `.env.example` versionado.
3. Suba a API (`cd packages/api && npm run dev`, porta `3333`) e o frontend
   (`cd apps/web && npm run dev`, porta `5173`).

## Fontes de dados implementadas

| Coletor | Fonte | Chave necessária | Dimensão |
|---|---|---|---|
| `collect:camara` | Câmara dos Deputados (dadosabertos.camara.leg.br) | Não | Produção legislativa |
| `collect:tse` | TSE — DivulgaCand | Não | Transparência (candidatura/bens) |
| `collect:transparencia` | Portal da Transparência (CGU) — CEIS/CNEP | Sim (grátis) | Integridade |
| `collect:youtube` | YouTube Data API v3 | Sim (grátis) | Comunicação |
| `collect:bluesky` | Bluesky (AT Protocol) | Não | Comunicação |
| `collect:meta-ads` | Meta Ad Library | Sim (verificação Meta) | Investimento em propaganda |
| `collect:datajud` | DataJud (CNJ) — metadados processuais | Sim (grátis) | Integridade (`estagio_juridico`) |
| `collect:tcu` | TCU — contas irregulares/inabilitados | Não | Integridade |
| `collect:dou` | Diário Oficial da União | Não | Atos oficiais |

Rode qualquer coletor com `--dry-run` para validar contra a fonte real sem
gravar no banco (não exige `SUPABASE_SERVICE_ROLE_KEY`):

```bash
cd packages/workers
npm run collect:camara -- --idCamara=<id> --dry-run
npm run collect:tse -- --dry-run
npm run collect:bluesky -- --candidatoId=<uuid> --handle=<handle.bsky.social> --dry-run
npm run compute:metricas   # agrega evento → metrica (hoje: producao_legislativa)
```

Todo coletor segue o mesmo contrato (`fetchAll → raw_payload com hash →
normalize → evento com dedup`), documentado em
[packages/workers/README.md](./packages/workers/README.md). Nenhum coletor
faz match fuzzy de identidade: quando a fonte não permite resolução
determinística (CPF, ID oficial), o `candidato_id` é sempre passado
explicitamente na linha de comando — nunca inferido por nome.

## Estado atual dos dados (Supabase)

- **224 candidatos** reais (5 Presidente, 5 Vice, 87 Governador, 119
  Senador, 8 Deputado Federal de teste), buscados ao vivo na API do TSE
  para a eleição de 2026.
- **~420 eventos reais** — candidatura e bens declarados (TSE) para 218
  candidatos, proposições legislativas (Câmara) para os deputados de teste.
  Nenhum evento fabricado; todos com `fonte_url` para a origem oficial.
- **Métricas**: só `producao_legislativa` está calculada (depende de dado
  de Câmara, que só existe para os deputados de teste). As outras 8
  dimensões aparecem como "sem dado" no frontend até os coletores de
  integridade/comunicação/propaganda rodarem com as chaves configuradas.

## API (`packages/api`, porta 3333)

`GET /health` · `GET /dimensoes` · `GET /candidatos` (filtros `uf`,
`cargo_pretendido`, `partido_atual`, `q`, paginação) · `GET /candidatos/:id`
· `GET /candidatos/:id/eventos` (filtros `tipo`, `categoria`, `tema`) ·
`GET /candidatos/:id/metricas`. Só leitura, usa a chave `anon` (RLS já
filtra o que é público). Detalhes em
[packages/api/README.md](./packages/api/README.md).

## Frontend (`apps/web`, porta 5173)

- **Início** — lista/busca de candidatos com filtros de UF, cargo e partido.
- **Perfil** — timeline de eventos com fonte linkada; `estagio_juridico`
  sempre exibido com o carimbo dedicado (nunca um selo binário).
- **Painel de pesos** — um fader por dimensão, score recalculado ao vivo no
  navegador, presets editáveis, link compartilhável (`?pesos=...`).
- **Comparador** (`/comparar`) — 2 a 4 candidatos lado a lado, mesma lógica
  de score, seleção compartilhável via URL (`?ids=...`).
- **Exportação** — relatório em Markdown (com todas as fontes) ou impressão/PDF.
- Todo número é clicável e abre os eventos que o compõem; nunca mostra 0
  para dimensão sem dado.

## Roadmap

Fases 0–4 do [documento de arquitetura](./projeto-monitor-candidatos.md)
têm implementação de código completa (coletores, API, frontend, comparador,
export). O que resta é operacional, não arquitetural:

- [ ] Configurar `PORTAL_TRANSPARENCIA_API_KEY`, `YOUTUBE_API_KEY`,
      `DATAJUD_API_KEY` (grátis) e o token da Meta Ad Library (verificação)
      em `packages/workers/.env`.
- [ ] Rodar os coletores de integridade/comunicação contra os 224
      candidatos reais e revisar manualmente todo evento de
      `categoria='controversia'` antes de publicar (RLS já exige isso).
- [ ] Popular `perfil_social` (handles verificados de YouTube/Bluesky) —
      seed manual, decisão editorial que nenhum coletor toma sozinho.
- [ ] Estender `compute:metricas` para as dimensões além de produção
      legislativa, condicionado aos coletores acima terem dado.
- [ ] Deploy em produção (hoje só roda local).
