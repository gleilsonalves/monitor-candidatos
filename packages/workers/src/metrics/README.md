# Camada de metrificação (`compute:metricas`)

Job que lê a tabela `evento` (fatos já coletados, cada um com fonte oficial)
e escreve métricas agregadas em `metrica`, que a API (`GET
/candidatos/:id/metricas`) e o frontend já consomem. Ver
[`../../../../projeto-monitor-candidatos.md`](../../../../projeto-monitor-candidatos.md)
(seção 4 — modelo de dados, seção 6 — camada de metrificação) e
[`../../README.md`](../../README.md) (framework de coletores que este job
reaproveita: `lib/supabaseClient.ts`, `lib/env.ts`, `lib/logger.ts`).

## Pipeline

```
evento (fatos com fonte oficial)  →  agregação por candidato_id  →  normalização 0-100  →  metrica (upsert por candidato_id+chave)
```

Entrypoint: `src/cli/computeMetricas.ts`. Estrutura deste diretório:

```
metrics/
  types.ts                 EventoContagemPorCandidato, MetricaComputada, MetricasStats
  minMaxScore.ts            computeMinMaxScore() — normalização genérica, reutilizável por qualquer dimensão futura
  producaoLegislativa.ts    única dimensão implementada hoje: fetch + build das métricas de produção legislativa
  upsertMetricas.ts        upsert manual (leitura antes de escrever) em `metrica`
  index.ts                 barrel de exports
```

## Princípio central (não-negociável — seção 1 e 9 do documento de arquitetura)

Este app **nunca emite veredito** sobre uma pessoa real, e isso vale
especialmente aqui: este job escreve números associados publicamente a
nomes de candidatos reais.

**Regra 1 — só calcular métrica onde há evento real.** Se um candidato não
tem nenhum `evento` de um tipo relevante para uma dimensão, **nenhuma linha
é gravada** em `metrica` para esse par (candidato, chave) — nem 0, nem 50,
nem 100. Ausência de dado não é prova de mérito nem de conduta irregular; um
valor forçado seria fabricação de avaliação sobre uma pessoa real. O
frontend já sabe lidar com dimensão sem dado suficiente (não aparece, não
vira "pior nota").

**Regra 2 — normalização documentada e auditável.** Ver "Fórmula de
normalização" abaixo.

**Regra 3 — nunca combinar categorias diferentes numa métrica só.** Por
exemplo, não misturar `categoria='realizacao'` com `categoria='controversia'`
numa métrica "score geral" — isso é o trabalho do painel de pesos do
frontend (calculado no cliente, com pesos do usuário), não deste job.

## O que está implementado hoje

Hoje só existem eventos reais de `tipo='proposicao', categoria='realizacao'`
(coletados da Câmara — `src/collectors/camara`). Por isso só a dimensão
**produção legislativa** está implementada:

| Chave | Valor | Normalizado? |
|---|---|---|
| `producao_legislativa.total_proposicoes` | Contagem bruta de eventos `tipo='proposicao'` por candidato | Não — dado auxiliar de transparência/auditoria |
| `producao_legislativa.score` | A mesma contagem, normalizada 0-100 | Sim — min-max dentro do conjunto de candidatos com >=1 proposição |

`producao_legislativa` é o mesmo prefixo (`chave`) da dimensão exposta por
`GET /dimensoes` (`packages/api/src/lib/dimensoes.ts`) — o frontend agrupa
métricas por dimensão usando o texto antes do primeiro `.` em `metrica.chave`.

**Nenhuma outra dimensão foi implementada** (assiduidade, coerência,
transparência, integridade, uso de recursos públicos, comunicação,
investimento em propaganda, foco temático) porque nenhuma delas tem dado
real suficiente no banco ainda — isso é trabalho futuro, condicionado à
entrega de mais coletores (TSE, Portal da Transparência, DataJud, YouTube,
Bluesky, Meta Ad Library, ...). Inventar lógica para uma dimensão sem dado
violaria a Regra 1 acima.

## Fórmula de normalização (Regra 2)

`computeMinMaxScore()` (`minMaxScore.ts`) implementa min-max simples e
defensável, dentro do conjunto de candidatos que têm **pelo menos 1 evento**
naquela dimensão:

```
score = (valor - min) / (max - min) * 100
```

Quem tem mais eventos no conjunto fica em 100, quem tem menos fica em 0, os
demais interpolam linearmente. `valor` aqui vem sempre de uma contagem bruta
já calculada (ex: `total_proposicoes`) — nunca de uma métrica que já
misture categorias diferentes (Regra 3).

**Caso de empate total** (`max === min`, inclusive quando só 1 candidato do
conjunto observado tem dado): não há variação para normalizar. Em vez de
zerar todo mundo — o que pareceria "pior do grupo" sem motivo real —
atribuímos **100 a todos**. É uma convenção arbitrária como qualquer outra
seria neste caso-limite, mas está documentada aqui e no código
(`minMaxScore.ts`) para ser auditável, conforme a Regra 2.

A função é genérica (`computeMinMaxScore(contagens, chaveBase)`) justamente
para ser reaproveitada por dimensões futuras sem duplicar a lógica de
normalização — só muda a origem da contagem (ex: presença em plenário para
`assiduidade`, quando o coletor de assiduidade existir).

## `periodo` (coluna `daterange` de `metrica`)

Fica **`null`** nesta fase — decisão deliberada pela opção mais simples
entre as duas descritas no escopo do job (`null` = "métrica vigente, sem
janela temporal definida" vs. um range aberto da data do evento mais antigo
até hoje). Como o job é recalculado periodicamente e sempre reflete o
estado atual de `evento`, um `periodo` fixo não agregaria informação hoje;
fica registrado aqui para reavaliar quando este job passar a rodar por
janela (ex: métricas por legislatura/mandato).

## Upsert

`metrica` **não tem** constraint `UNIQUE (candidato_id, chave)` no banco —
só um índice não-único (`metrica_candidato_chave_idx`). Por isso
`upsertMetricas.ts` faz leitura-antes-de-escrever (mesmo padrão de
`Collector.upsertEvento` em `src/collector.ts`): se já existe uma linha para
o par, atualiza `valor`/`periodo`/`calculado_em`; senão insere. Isso evita
duplicar linhas a cada execução — diferente de `evento`/`raw_payload`
(append-only), este job representa o valor vigente, não um histórico.

## Rodando

```bash
npm install

# 1) Dry-run: lê eventos reais do banco (só precisa da chave anon/pública,
#    já pública em .env.example na raiz do monorepo) e imprime no console o
#    que seria gravado — não grava nada, não precisa de SUPABASE_SERVICE_ROLE_KEY.
npm run compute:metricas -- --dry-run

# 2) Execução real (grava em `metrica`) — precisa de SUPABASE_SERVICE_ROLE_KEY
#    em packages/workers/.env (mesma variável usada pelos coletores, ver
#    ../../README.md):
cp .env.example .env   # preencha SUPABASE_SERVICE_ROLE_KEY
npm run compute:metricas
```

Sem `SUPABASE_SERVICE_ROLE_KEY` configurada, a execução sem `--dry-run`
falha na inicialização com uma mensagem explicando exatamente o que fazer
(mesmo comportamento de `loadEnv()`, reaproveitado de `lib/env.ts` — não
duplicado aqui). O modo `--dry-run` usa `SUPABASE_ANON_KEY` (ou o valor
publishable já commitado em `.env.example` na raiz do monorepo, como
fallback, do mesmo jeito que `lib/env.ts` já tem um fallback público para
`CAMARA_API_BASE`) porque só faz leitura — a policy `"public read evento"`
já libera `SELECT` em eventos `categoria <> 'controversia'` (todo evento de
`tipo='proposicao'` hoje é `categoria='realizacao'`), então o dry-run lê
dado real, não um mock.

## Como adicionar uma nova dimensão (quando houver dado real)

1. Confirme que já existe coletor gravando eventos suficientes para a
   dimensão em `evento` (Regra 1 — nunca adiante isso).
2. Crie `src/metrics/<dimensao>.ts` seguindo o padrão de
   `producaoLegislativa.ts`: uma função `fetchContagem...PorCandidato()` que
   agrega `evento` por `candidato_id` (filtrando por `tipo`/`categoria`
   apropriados, nunca misturando categorias — Regra 3), e uma função
   `buildMetricas...()` que chama `computeMinMaxScore()` para a chave
   `.score` e monta qualquer métrica bruta auxiliar (`.total_...`) que fizer
   sentido documentar.
3. Confirme que o prefixo de chave (`chaveBase`) casa exatamente com a
   `chave` da dimensão em `packages/api/src/lib/dimensoes.ts` (não edite
   esse arquivo — só confira o valor).
4. Chame a nova função a partir de `src/cli/computeMetricas.ts` (ou de um
   novo CLI dedicado, se preferir rodar dimensões separadamente) e faça o
   upsert com `upsertMetricas()` (já genérico, não precisa de mudança).
