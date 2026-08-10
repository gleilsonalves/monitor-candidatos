# @monitor-candidatos/workers

Framework de coletores (workers) do Monitor de Candidatos e o primeiro
adaptador concreto: proposições de deputados na Câmara dos Deputados. Ver
[`../../projeto-monitor-candidatos.md`](../../projeto-monitor-candidatos.md)
(seções 2, 3, 5, 7 e 10) para a arquitetura completa.

## Pipeline

```
fetchAll()  →  raw_payload (hash + append-only)  →  normalize()  →  evento (upsert com dedup por hash)
```

1. **`fetchAll()`** busca os dados brutos na fonte (paginação, retry e rate
   limit ficam no client HTTP de cada adaptador).
2. Cada registro bruto é gravado em `raw_payload` **antes** de qualquer
   normalização — auditoria e replay (seção 3). O hash é calculado sobre
   `fonte + JSON canônico do payload`: mesmo conteúdo → mesma linha (dedup);
   conteúdo diferente (ex: ementa retificada) → nova linha.
3. **`normalize(raw)`** mapeia o registro bruto para o formato de `evento`.
   Retornar `null` pula o registro (ex: dado obrigatório ausente, entidade
   não resolvida) — nunca insere um evento incompleto.
4. **Entity resolution** acontece em `prepare()` (hook chamado antes do
   fetch): para a Câmara é **determinística** via `id_camara` (seção 5,
   passo 1 — confiança 1.0). Nunca há fuzzy match nem criação de candidato
   novo aqui; se o `id_camara` não existir em `candidato`, `prepare()`
   retorna `false` e `run()` aborta **sem gravar nada** (nenhum evento
   órfão).
5. O evento é gravado em `evento` com upsert por `hash_conteudo UNIQUE`: já
   existe → atualiza; não existe → insere. `fonte_url` nunca é omitido (é
   `NOT NULL` no banco e obrigatório no tipo `NormalizedEventoInput`).

Cada execução retorna um `CollectorStats` e imprime um log estruturado
(JSON lines) com `buscados / raw_inseridos / raw_duplicados /
eventos_inseridos / eventos_atualizados / eventos_pulados / erros` —
requisito de observabilidade da seção 7 (fonte que quebra silenciosamente é
o pior cenário).

## Estrutura

```
src/
  types.ts                    tipos compartilhados (TipoEvento, NormalizedEventoInput, CollectorStats, ...)
  collector.ts                classe base abstrata Collector<TRaw> — o framework
  lib/
    env.ts                    carrega e valida variáveis de ambiente
    supabaseClient.ts         client Supabase com service_role key (bypassa RLS)
    httpClient.ts             fetchJson() com retry/backoff exponencial + RateLimiter
    hash.ts                   sha256Hex() + canonicalJsonStringify() (hash estável)
    text.ts                   truncate() para gerar resumo sem LLM
    logger.ts                 log estruturado (JSON lines) em console
  collectors/
    camara/
      types.ts                tipos da API da Câmara (ProposicaoResumo, ...)
      client.ts                CamaraApiClient — paginação + retry + rate limit
      collector.ts              CamaraProposicoesCollector extends Collector
  cli/
    collectCamara.ts           entrypoint de linha de comando
```

## A classe base `Collector<TRaw>`

Todo adaptador de fonte (TSE, Portal da Transparência, DataJud, TCU,
YouTube, Bluesky, Meta Ads, DOU, ...) estende `Collector<TRaw>`
(`src/collector.ts`) e implementa:

- `readonly fonte: string` — identificador curto (usado em `raw_payload.fonte` e nos logs)
- `fetchAll(): Promise<TRaw[]>` — busca os dados brutos
- `normalize(raw: TRaw): NormalizedEventoInput | null` — mapeia para `evento`
- `prepare(): Promise<boolean>` (opcional) — setup/entity resolution antes do fetch; `false` aborta o `run()`

A classe base cuida do resto: gravação em `raw_payload` com dedup, chamada de
`normalize()`, upsert em `evento` com dedup, contadores e log de resumo.
Retry e rate limit **não** estão na classe base — cada adaptador usa
`lib/httpClient.ts` (`fetchJson()` com retry/backoff exponencial simples de
2-3 tentativas, e `RateLimiter` para delay configurável entre requisições)
dentro do seu próprio client HTTP, porque cada fonte tem limites e formatos
de paginação diferentes.

## Como adicionar um novo coletor

1. Crie `src/collectors/<fonte>/types.ts` com os tipos da resposta da API.
2. Crie `src/collectors/<fonte>/client.ts` com um client HTTP dedicado,
   usando `fetchJson()` (retry) e `RateLimiter` (delay entre chamadas) de
   `lib/httpClient.ts`.
3. Crie `src/collectors/<fonte>/collector.ts` estendendo `Collector<TRaw>`:
   - implemente `prepare()` se a fonte precisar de entity resolution antes
     do fetch (ex: buscar o `candidato_id` a partir de um ID determinístico,
     como fez `CamaraProposicoesCollector` com `id_camara`);
   - implemente `fetchAll()` chamando o client;
   - implemente `normalize()` retornando `NormalizedEventoInput` ou `null`.
   - **`hash_conteudo`** precisa ser estável e único por fato: combine
     `tipo + candidato_id + identificador da fonte` (não inclua campos que
     podem mudar de valor sem o fato deixar de ser "o mesmo evento", como
     texto de ementa).
   - Se o evento for `tipo='processo'`, `estagio_juridico` é **obrigatório**
     (um dos 8 valores do enum); para qualquer outro tipo tem que ser
     `null` — o banco rejeita o insert/update com um CHECK constraint caso
     contrário.
4. Crie `src/cli/collect<Fonte>.ts` seguindo o padrão de
   `collectCamara.ts` (parse de args, `loadEnv()`, `createWorkerSupabaseClient()`,
   `new SeuCollector(...).run()`, print de `CollectorStats`).
5. Adicione o script no `package.json` (`"collect:<fonte>": "tsx src/cli/collect<Fonte>.ts"`).

## Coletor da Câmara dos Deputados

Busca as proposições de autoria de um deputado
(`GET /proposicoes?idDeputadoAutor={id}&itens=100`, paginado via o link
`rel=next`) e grava um `evento` por proposição:

| Campo | Valor |
|---|---|
| `tipo` | `'proposicao'` |
| `categoria` | `'realizacao'` (autoria é produção legislativa, não controvérsia) |
| `estagio_juridico` | `null` (só se aplica a `tipo='processo'`) |
| `titulo` | `"{siglaTipo} {numero}/{ano}"`, ex: `"PL 1234/2024"` |
| `resumo` | ementa truncada em 500 caracteres (dado oficial estruturado — não precisa de LLM nesta fase) |
| `data_evento` | data de apresentação da proposição |
| `fonte_nome` | `"Câmara dos Deputados"` |
| `fonte_url` | `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao={id}` |
| `fonte_confianca` | `1` (oficial) |

### Rodando

```bash
npm install

# 1) Validar fetch/normalize contra a API real da Câmara, SEM gravar no banco
#    e SEM precisar de SUPABASE_SERVICE_ROLE_KEY:
npm run collect:camara -- --idCamara=204554 --dry-run

# 2) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY:
cp .env.example .env   # preencha SUPABASE_SERVICE_ROLE_KEY (ver abaixo)
npm run collect:camara -- --idCamara=204554

# alternativa: definir CAMARA_ID_DEPUTADO no .env em vez de passar --idCamara
```

`idCamara` é o `id_camara` do deputado — **precisa já existir na tabela
`candidato`** (ver seed manual mencionado na Fase 0 do roadmap). Se não
existir, o coletor loga um aviso e encerra sem gravar nada (não insere
eventos órfãos).

### Variáveis de ambiente (`.env`)

Copie `.env.example` para `.env` neste pacote e preencha:

- `SUPABASE_URL` — já vem preenchida (`https://mjojuycrkxidpkzyzuuz.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — **obrigatória para gravar dados**. As tabelas
  `raw_payload` e `evento` têm RLS habilitado sem policy pública de
  `INSERT`, então só a `service_role` key (que ignora RLS) pode escrever.
  Pegue em: Supabase Dashboard → Project Settings → API → `service_role`.
  **Nunca** exponha essa chave no frontend nem comite o `.env` preenchido.
  Sem ela, o comando falha na inicialização com uma mensagem explicando
  exatamente o que fazer (não um crash genérico) — use `--dry-run` nesse
  meio tempo para validar fetch/normalize.
- `CAMARA_API_BASE` — já vem preenchida, API pública sem chave.
- `CAMARA_ID_DEPUTADO` — opcional, usado quando `--idCamara` não é passado.

## Scripts

- `npm run collect:camara -- --idCamara=<id> [--dry-run]` — roda o coletor da Câmara
- `npm run build` — compila para `dist/`
- `npm run typecheck` — checa tipos sem gerar output

## Decisões de design não óbvias

- **`raw_payload` com hash de conteúdo, não de identificador**: o hash do
  registro bruto usa o payload inteiro (canonicalizado), não só o ID da
  proposição. Assim, se a Câmara retificar uma ementa, isso gera uma nova
  linha em `raw_payload` (preserva histórico para auditoria/replay), mas o
  `evento` correspondente é **atualizado** (não duplicado), porque o hash do
  evento usa só `tipo + candidato_id + id da proposição`.
- **Upsert por leitura-antes-de-escrever, não `ON CONFLICT` nativo do
  Postgres via supabase-js**: o client `@supabase/supabase-js` não expõe um
  jeito direto de diferenciar "inseriu" de "atualizou" num único `upsert()`
  quando se precisa dessa distinção para as métricas de observabilidade.
  Optou-se por `select` por `hash_conteudo` seguido de `insert`/`update`
  explícitos — janela de corrida pequena e aceitável para um worker de
  execução única (não concorrente).
- **`prepare()` como hook de entity resolution**: mantém `fetchAll()` e
  `normalize()` desacoplados de como cada fonte resolve o candidato. Para a
  Câmara isso é uma única consulta determinística por `id_camara` antes de
  buscar qualquer proposição; fontes futuras com match fuzzy (seção 5,
  passos 3-4) podem sobrescrever `prepare()` de forma diferente sem mudar o
  contrato da classe base.
- **Modo `--dry-run`**: só chama `fetchAll()` + `normalize()`, nunca
  `run()`, então nunca precisa de `SUPABASE_SERVICE_ROLE_KEY` nem de um
  client Supabase real. Usa um `candidato_id` placeholder
  (`definirCandidatoParaInspecao()`) só para poder inspecionar a forma do
  evento normalizado — deixa isso explícito no output (`aviso`) para não
  ser confundido com um ID real.
