# Coletor do Bluesky (AT Protocol)

Coleta os posts recentes de um candidato no Bluesky — dimensão "Comunicação"
(seção 6 do documento de arquitetura, `projeto-monitor-candidatos.md`). Ver
[`../../../README.md`](../../../README.md) para o framework de coletores em
geral (pipeline, `Collector<TRaw>`, como rodar) — este arquivo documenta só
o que é específico desta fonte.

## Endpoints usados

API pública do AT Protocol, **sem chave, sem autenticação**, confirmada
contra os lexicons oficiais em
`github.com/bluesky-social/atproto/lexicons/app/bsky/{actor,feed}/...` e
contra chamadas reais em 10/08/2026:

Base: `https://public.api.bsky.app/xrpc`

| Endpoint | Uso |
|---|---|
| `GET /app.bsky.actor.getProfile?actor={handle}` | Resolve o `did` (identificador estável, imutável) e o handle canônico a partir do handle informado. Parâmetro `actor` aceita handle ou DID (formato "at-identifier"). |
| `GET /app.bsky.feed.getAuthorFeed?actor={handle}&limit={1-100}&cursor={cursor}` | Lista posts e reposts de autoria do actor, mais recentes primeiro, paginado via `cursor` (não há `rel=next` como na Câmara — o token de paginação vem no corpo da resposta). `limit` máximo por página é 100. Filtro default da API (`posts_with_replies`, não passado explicitamente) inclui tanto posts originais quanto respostas do próprio actor. |

Confirmado com chamadas reais (não documentação só lida, testado de
verdade):

```bash
$ curl -s "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app"
{"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky",...
 "followersCount":34465479,"followsCount":11,"postsCount":806,...}

$ curl -s "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=3"
{"feed":[{"post":{"uri":"at://did:plc:.../app.bsky.feed.post/3msqpusnigc2t","cid":"...",
 "author":{"did":"did:plc:...","handle":"bsky.app"},
 "record":{"$type":"app.bsky.feed.post","createdAt":"2026-08-10T18:23:59.963Z","text":"..."},
 "replyCount":18,"repostCount":81,"likeCount":591,"quoteCount":47,"indexedAt":"...","labels":[]},
 ...}]}
```

## `fonte_url` — link público do post

Formato confirmado navegando de `at://{did}/app.bsky.feed.post/{rkey}`
(campo `post.uri`) para a URL humana equivalente:

```
https://bsky.app/profile/{handle}/post/{rkey}
```

`{rkey}` é o último segmento de `post.uri` (após a última `/`). `{handle}` é
o handle **canônico** devolvido por `getProfile()` (não necessariamente
idêntico, em capitalização, ao `--handle` informado na CLI).

## Entity resolution — a limitação real

Este é o ponto mais importante deste coletor, junto com o do Portal da
Transparência. `perfil_social` (a tabela pensada exatamente para vincular um
`handle` a um `candidato_id`) está **vazia hoje**. Não existe, portanto,
nenhum caminho determinístico dentro do banco de `candidato_id` para
`handle` do Bluesky — e não há como derivar um a partir do outro sem
adivinhar.

**Este coletor nunca infere o handle a partir do nome do candidato.**
Compor um handle plausível (ex: `nome_urna` normalizado + `.bsky.social`) e
tratá-lo como correto seria exatamente o cenário que a seção 5 do documento
proíbe: "nunca deixar match fuzzy alimentar métrica direto... é o pior bug
possível deste sistema". Atribuir os posts de outra pessoa (homônimo, perfil
de paródia, conta não oficial) a um candidato seria pior aqui do que em
outras fontes, porque o conteúdo entra como fala do próprio candidato.

### Solução adotada: `candidato_id` + `handle`, ambos explícitos

A CLI **exige os dois como parâmetros separados**, nunca um derivado do
outro:

```bash
npm run collect:bluesky -- --candidatoId=<uuid> --handle=<handle.bsky.social>
```

`prepare()` faz só duas verificações, ambas determinísticas, nenhuma fuzzy:

1. `candidato_id` informado existe mesmo na tabela `candidato` (protege
   contra UUID errado/digitado à mão gerar eventos órfãos — mesmo padrão de
   "aborta sem gravar nada" da Câmara/Transparência).
2. `handle` informado resolve de verdade via `getProfile()` (protege contra
   handle inexistente/digitado errado; se a API não resolver, aborta sem
   gravar nada).

O vínculo "este `candidato_id` é dono deste `handle`" em si — a parte que
realmente importa — **não é verificado por este coletor**, porque não há
como verificá-lo automaticamente sem cair em match fuzzy por nome. Essa
correspondência precisa ser confirmada por um humano fora deste coletor
(seed manual de `perfil_social`, mencionado na Fase 0 do roadmap: "Seed
manual de 5–8 candidatos com handles sociais validados à mão") antes de
rodar a coleta real para um candidato. `--candidatoId` + `--handle` sendo
explícitos e auditáveis na linha de comando é o que torna esse vínculo
rastreável (quem rodou o quê, quando), não uma prova de que o vínculo está
certo.

## Reposts não são fala própria — filtrados em `normalize()`

`getAuthorFeed` devolve tanto posts/respostas de autoria do actor quanto
**reposts** que ele fez de posts de terceiros (o `post` embutido pertence a
outro `author`). Um repost não é o candidato falando — é ele amplificando a
fala de outra pessoa. `normalize()` descarta esses itens por duas
verificações redundantes:

1. `raw.reason.$type === "app.bsky.feed.defs#reasonRepost"` (o jeito
   "oficial" do feed marcar um repost).
2. `post.author.did !== did_resolvido_do_candidato` (proteção adicional,
   cobre qualquer forma do feed trazer conteúdo de terceiros mesmo sem
   `reason` explícito).

Validado na prática contra `bsky.app` (que reposta bastante): de 952 itens
buscados, o primeiro repost encontrado (post de `buttondown.com`
republicado) foi corretamente pulado com o log `"item é um repost de outro
autor — pulando"`.

## Contagens de engajamento — só como número, nunca como proxy de sentimento

O payload de cada post traz `likeCount`, `repostCount`, `replyCount` e
`quoteCount`. Eles são preservados **inteiros em `raw_payload`** (o payload
bruto completo é gravado antes de qualquer normalização — pipeline padrão do
framework), mas **não viram colunas de `evento`** — o schema não tem espaço
para eles ali, e o uso correto dessas contagens é agregado (ex: cálculo de
"engajamento relativo" na tabela `metrica`, seção 6 do documento), tarefa de
um job de métricas separado (`compute:metricas`, fora do escopo deste
coletor), não deste adaptador.

O documento é explícito sobre o que **não** medir: **nunca** o conteúdo das
respostas/comentários de terceiros como proxy de qualidade — "é o vetor mais
fácil de manipular por bot e envenenaria toda a base" (seção 2.2). Este
coletor não busca replies de terceiros a post nenhum, só os posts de autoria
do próprio candidato — as contagens agregadas ficam disponíveis para uso
futuro, o conteúdo de terceiros nunca é sequer buscado.

## Nota sobre `fonte_confianca`

O comentário do schema (`db/migrations/0001_core_schema.sql`) documenta a
convenção geral `1=oficial 2=imprensa 3=social`. Este coletor grava
`fonte_confianca=1` mesmo assim, por instrução explícita da tarefa que o
originou: o conteúdo vem direto da API oficial da própria plataforma e é
**fala primária do próprio candidato** (não uma alegação de terceiro sobre
ele, que é o risco que a categoria "social=3" normalmente sinaliza — ex.:
um post de outra pessoa mencionando o candidato seria, sim, confiança 3).
Fica registrado aqui para quem for revisar a convenção depois: há uma
tensão real entre "é uma rede social" e "é o próprio candidato falando",
resolvida a favor do segundo neste coletor.

## Modelagem em `evento`

| Campo | Valor |
|---|---|
| `tipo` | `'post'` |
| `categoria` | `'neutro'` (o conteúdo do post não é classificado como realização/controvérsia nesta fase — fica para a classificação temática por LLM da Fase 2) |
| `estagio_juridico` | `null` (só se aplica a `tipo='processo'`) |
| `titulo` | primeiros ~80 caracteres do texto do post, ou `"Post no Bluesky"` se o post não tiver texto (só mídia) |
| `resumo` | texto completo do post truncado em 500 caracteres — conteúdo primário do próprio candidato, não precisa de LLM |
| `data_evento` | `record.createdAt` do post (data de criação, não `indexedAt`) |
| `fonte_nome` | `"Bluesky"` |
| `fonte_url` | `https://bsky.app/profile/{handle}/post/{rkey}` |
| `fonte_confianca` | `1` (ver nota acima) |
| `hash_conteudo` | `sha256("post|{candidato_id}|bluesky|{post.uri}")` — `post.uri` é o identificador estável do post no AT Protocol, não muda mesmo que o texto seja re-lido pela API depois (o Bluesky nem permite editar posts hoje) |

## Como testar

```bash
# validar fetch/normalize contra a API real do Bluesky, sem gravar no banco e
# sem SUPABASE_SERVICE_ROLE_KEY — qualquer handle público real funciona:
npm run collect:bluesky -- --handle=bsky.app --dry-run

# coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY e
# de um candidato_id já cadastrado em `candidato`:
npm run collect:bluesky -- --candidatoId=<uuid> --handle=<handle.bsky.social>
```

Testado de verdade em 10/08/2026 contra `bsky.app` (conta pública real,
ativa, escolhida só para provar o parsing contra payload real — não é conta
de candidato brasileiro): `--dry-run` buscou **952 itens de feed em 10
páginas** (paginação via `cursor` funcionando ponta a ponta), corretamente
descartou o primeiro repost encontrado (post de `buttondown.com`), e
normalizou os 4 posts próprios restantes da amostra em `evento`s válidos —
ex.: título `"We also added thread numbering: Posts in a thread are numbered
automatically, s…"`, `fonte_url`
`https://bsky.app/profile/bsky.app/post/3msqpusnigc2t`,
`fonte_confianca=1`, `hash_conteudo` estável de 64 hex chars.

Se `candidato_id` não existir na tabela `candidato`, ou se `handle` não
resolver via API, o coletor loga um aviso e encerra sem gravar nada (mesmo
padrão dos demais coletores).

## Variáveis de ambiente (`.env`, neste pacote)

- `BLUESKY_API_BASE` — opcional, default `https://public.api.bsky.app/xrpc`
  (API pública, sem chave — não precisa estar no `.env.example`, o default
  já cobre o uso normal).
- **Não existe** variável de ambiente para `--candidatoId` nem `--handle` —
  ambos só por linha de comando, de propósito, para que cada execução real
  seja um vínculo candidato↔handle explícito e auditável (ver "Entity
  resolution" acima).

## Estrutura

```
bluesky/
  types.ts     tipos da API do AT Protocol (BlueskyProfile, BlueskyFeedViewPost, ...) —
               confirmados contra os lexicons oficiais e contra chamadas reais
  client.ts    BlueskyApiClient — getProfile(), getAuthorFeed() com paginação por
               cursor, retry, rate limit
  collector.ts BlueskyCollector extends Collector<BlueskyFeedViewPost> — prepare()
               valida candidato_id + resolve handle via API; normalize() filtra
               reposts e monta o evento
```
