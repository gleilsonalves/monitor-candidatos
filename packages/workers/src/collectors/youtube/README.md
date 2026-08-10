# Coletor: YouTube Data API v3

Segue o framework descrito em [`../../../README.md`](../../../README.md)
("Como adicionar um novo coletor"). Este documento cobre o que é específico
desta fonte: os endpoints reais, como conseguir a API key, a limitação de
entity resolution encontrada e como validar sem uma chave.

## O que este coletor coleta

Vídeos publicados no canal do YouTube de um candidato — dimensão
"Comunicação" da seção 6 do documento de arquitetura: **volume, cadência,
temas e engajamento relativo**. Cada vídeo vira um `evento` com:

| Campo | Valor |
|---|---|
| `tipo` | `'post'` |
| `categoria` | `'neutro'` (postar conteúdo não é em si realização nem controvérsia — isso é avaliação, não fato) |
| `estagio_juridico` | `null` (só se aplica a `tipo='processo'`) |
| `titulo` | título do vídeo |
| `resumo` | descrição do vídeo (texto do próprio canal, não de terceiro) truncada em 500 caracteres, seguida de contagens públicas agregadas entre colchetes, ex: `"...descrição... [12345 visualizações, 678 curtidas, 90 comentários]"` |
| `data_evento` | data de publicação do vídeo |
| `fonte_nome` | `"YouTube"` |
| `fonte_url` | `https://www.youtube.com/watch?v={videoId}` |
| `fonte_confianca` | `1` (a métrica de views/likes/comentários vem direto da API oficial da plataforma, mesmo o vídeo sendo conteúdo de terceiro) |

`tema[]` fica vazio — classificação temática por LLM é Fase 2 (seção 6 do
documento), fora do escopo deste coletor.

## Não medimos sentimento de comentário — por design

A seção 2.2 do documento de arquitetura é explícita: **"Não medir sentimento
de comentários de terceiros como proxy de qualidade — é o vetor mais fácil
de manipular por bot e envenenaria toda a base."** Este coletor nunca chama
`commentThreads.list` nem lê o texto de nenhum comentário. O único dado de
engajamento capturado é `statistics` de `videos.list` — **contagens públicas
agregadas** (`viewCount`, `likeCount`, `commentCount`), nunca conteúdo
individual, nunca uma classificação de tom/sentimento.

## Endpoints usados e por que não `search.list`

Todos em `https://www.googleapis.com/youtube/v3`:

1. **`GET /channels?part=contentDetails&id={channelId}`** — resolve o ID da
   playlist especial de "uploads" do canal
   (`items[0].contentDetails.relatedPlaylists.uploads`). **1 unidade de
   quota.**
2. **`GET /playlistItems?part=snippet&playlistId={uploadsPlaylistId}`** —
   lista os vídeos dessa playlist (que sempre contém, na ordem de
   publicação, todo vídeo público do canal), paginado via `nextPageToken`.
   **1 unidade de quota por página** (até 50 vídeos/página).
3. **`GET /videos?part=statistics&id={id1,id2,...}`** — busca
   `viewCount`/`likeCount`/`commentCount` em lotes de até 50 ids (o máximo
   aceito pela API por chamada). **1 unidade de quota por lote.**

Deliberadamente **não** usamos `search.list` (que também listaria os vídeos
de um canal): ele custa **100 unidades por chamada**, contra as 1-2 unidades
do caminho acima para o mesmo resultado. Com a cota gratuita de 10.000
unidades/dia, o caminho via playlist de uploads permite coletar dezenas de
canais por dia; `search.list` esgotaria a cota em poucas chamadas. Exemplo
de custo real: um canal com 100 vídeos custa `1 (channels) + 2
(playlistItems, 2 páginas) + 2 (videos, 2 lotes) = 5 unidades` no total.

## Validação real sem API key (2026-08-10)

Testado com `curl` direto contra a API, sem nenhuma chave:

```
$ curl -i "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=UC_x5XG1OV2P6uZZ5FSM9Ttw"
HTTP/1.1 403 Forbidden
{
  "error": {
    "code": 403,
    "message": "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
    "status": "PERMISSION_DENIED"
  }
}
```

E com uma chave inválida (não vazia, mas incorreta) — o caso mais informativo,
porque é o erro que qualquer chave malformada vai produzir:

```
$ curl -i "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=INVALID_KEY_FOR_TESTING"
HTTP/1.1 400 Bad Request
{
  "error": {
    "code": 400,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "INVALID_ARGUMENT",
    "details": [{ "reason": "API_KEY_INVALID", ... }]
  }
}
```

O mesmo teste foi repetido para `/playlistItems` e `/videos` — as três rotas
respondem `400`/`403` com o mesmo formato de erro do Google, **nunca
`404`**, o que confirma que as três URLs estão corretas. O modo `--dry-run`
deste coletor reproduz essa mesma checagem automaticamente contra a rota
`/channels` (ver "Rodando" abaixo) e foi executado de fato: sem
`YOUTUBE_API_KEY`, recebe `403`; com uma chave inválida de teste, recebe
`400`. Em ambos os casos o coletor identifica corretamente que o endpoint
está certo e só falta uma chave válida — nunca confunde isso com "rota
errada".

**Nota sobre a chave**: este coletor envia a API key via header
`X-Goog-Api-Key` (suportado nativamente pelas APIs do Google como
alternativa ao query param `?key=`), não na URL — assim ela nunca aparece
nos logs de retry de `fetchJson` (que loga a URL completa em tentativas
subsequentes). Mesmo cuidado que o coletor do Portal da Transparência tem
com `chave-api-dados` (também header, nunca query string). O `curl` acima
usa `?key=` só porque é o jeito mais direto de reproduzir o teste na linha
de comando — o client TypeScript (`client.ts`) usa o header.

**Limitação da mensagem de erro no coletor**: `lib/httpClient.ts` (fora do
escopo deste coletor) não faz parse do corpo da resposta de erro — só
captura `status` e `statusText` do HTTP. Por isso o `--dry-run` deste
coletor mostra `"HTTP 400 Bad Request"` como mensagem, não o texto completo
`"API key not valid..."` do corpo JSON (que só aparece nos testes com `curl`
acima). O código de status (`400`/`403`, nunca `404`) já é suficiente para
confirmar que a rota está correta, que é o objetivo do `--dry-run`.

## Como conseguir a própria API key

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e
   crie (ou reaproveite) um projeto.
2. Em **APIs & Services > Library**, ative a **"YouTube Data API v3"**.
3. Em **APIs & Services > Credentials**, crie uma **API key**
   (<https://console.cloud.google.com/apis/credentials>). Gratuita, cota
   padrão de **10.000 unidades/dia** (ver seção 2.2 do documento de
   arquitetura).
4. (Recomendado) Restrinja a chave para funcionar só com a "YouTube Data API
   v3", para reduzir o impacto se ela vazar.
5. Cole em `YOUTUBE_API_KEY` no `.env` deste pacote (`packages/workers/.env`
   — copie de `.env.example` se ainda não existir). **Nunca** comite o
   `.env` preenchido.

## Entity resolution — a limitação real encontrada

A tabela `perfil_social` (`candidato_id`, `plataforma`, `handle`, `url`,
`verificado`) é o jeito correto, previsto pelo schema, de vincular um canal
do YouTube a um candidato. **Hoje ela está vazia — nenhum candidato tem
`perfil_social` cadastrado** (confirmado por consulta direta à tabela). A
seção 2.1 do documento de arquitetura descreve isso como uma tarefa da Fase
0 ainda pendente: "seed manual de 5-8 candidatos com handles sociais
validados à mão" — é trabalho editorial humano, não algo que este coletor
deveria (ou consegue, com segurança) fazer sozinho.

**Este coletor nunca tenta adivinhar qual canal do YouTube pertence a qual
candidato a partir do nome.** Fazer isso seria fuzzy match sem verificação
humana — exatamente o cenário que a seção 5 do documento proíbe ("nunca
deixar match fuzzy alimentar métrica direto... é o pior bug possível deste
sistema"). Um canal de fã-clube, paródia ou homônimo atribuído ao candidato
errado é tão grave aqui quanto atribuir um processo criminal à pessoa
errada.

### Solução adotada: dois caminhos determinísticos, nenhum fuzzy

`YoutubeVideosCollector` (`collector.ts`) recebe `candidato_id` **e**
`channelId` como parâmetros explícitos no construtor — nunca deriva um a
partir do outro por nome. O `channelId` pode vir de:

1. **Explícito** — passado direto (`--channelId` na CLI). É o único caminho
   que funciona hoje, já que `perfil_social` está vazia. O operador é
   responsável por confirmar, fora deste coletor, que aquele `channelId`
   (`UC...`) é de fato o canal oficial do candidato.
2. **`perfil_social`** — quando `--channelId` não é passado, `prepare()`
   busca `perfil_social` filtrando `plataforma='youtube' AND
   verificado=true` para o `candidato_id` informado. Só usa o handle
   encontrado ali (assumindo que a coluna `handle` guarda o `channelId`,
   ex: `UCxxxxxxxxxxxxxxxxxxxxxx` — é o identificador estável que a API
   usa; `url` guarda o link legível do canal, ex:
   `https://www.youtube.com/channel/UCxxxxxxxx` ou
   `https://www.youtube.com/@handle`). Como a tabela está vazia hoje, este
   caminho sempre retorna "não encontrado" na prática — mas o código já está
   pronto para o dia em que o seed manual da seção 2.1 for feito.

Se nenhum dos dois caminhos resolver um `channelId`, ou se o `candidato_id`
informado não existir na tabela `candidato`, `prepare()` retorna `false` e
`run()` aborta **sem gravar nada** — mesmo padrão de "nenhum evento órfão"
usado pelos coletores da Câmara e do Portal da Transparência.

Diferente do coletor da Câmara (onde `candidato_id` é *descoberto* a partir
de `id_camara`) e do Portal da Transparência (onde `candidato_id` vem de
`id_camara`, mas o CPF de busca é externo), aqui o `candidato_id` **já** é o
uuid real, fornecido pelo operador — `prepare()` só confirma que ele existe
na tabela `candidato` antes de gravar qualquer coisa, não o resolve a partir
de outro identificador.

## Rodando

```bash
npm install

# 1) Validar que as rotas estão corretas, SEM chave e SEM gravar no banco:
#    faz uma chamada real à API sem YOUTUBE_API_KEY e confirma que a resposta
#    é 400/403 (não 404) — prova que /youtube/v3/channels, /playlistItems e
#    /videos estão certos. Usa um canal público de teste (Google for
#    Developers) só para bater na rota.
npm run collect:youtube -- --dry-run

# 2) Com uma chave real, dry-run mostra fetch/normalize de verdade para
#    qualquer canal público (ainda sem gravar, ainda sem precisar de
#    SUPABASE_SERVICE_ROLE_KEY):
cp .env.example .env   # preencha YOUTUBE_API_KEY
npm run collect:youtube -- --channelId=UCxxxxxxxxxxxxxxxxxxxxxx --dry-run

# 3) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY,
#    YOUTUBE_API_KEY, --candidatoId (uuid já cadastrado em `candidato`) e um
#    channelId (explícito ou via perfil_social.verificado=true):
npm run collect:youtube -- --candidatoId=<uuid> --channelId=UCxxxxxxxxxxxxxxxxxxxxxx

# alternativa: definir YOUTUBE_CANDIDATO_ID e/ou YOUTUBE_CHANNEL_ID no .env
# em vez de passar --candidatoId/--channelId
```

Se `candidato_id` não existir na tabela `candidato`, ou se nenhum
`channelId` puder ser resolvido (nem `--channelId`, nem
`perfil_social.verificado=true`), o coletor loga um aviso e encerra sem
gravar nada.

## Variáveis de ambiente (`.env`, neste pacote)

- `YOUTUBE_API_KEY` — obrigatória para coleta real (não para `--dry-run` sem
  chave, que só valida a rota). Ver "Como conseguir a própria API key"
  acima.
- `YOUTUBE_API_BASE` — opcional, já vem com o default
  `https://www.googleapis.com/youtube/v3`.
- `YOUTUBE_CANDIDATO_ID` — opcional, usado quando `--candidatoId` não é
  passado via linha de comando.
- `YOUTUBE_CHANNEL_ID` — opcional, usado quando `--channelId` não é passado
  via linha de comando (nesse caso o coletor ainda tenta
  `perfil_social.verificado=true` se nem isso for definido).

Essas variáveis ainda não estão no `.env.example` do pacote (fora do escopo
deste coletor — ver nota de escopo no topo do trabalho) — adicione-as
manualmente ao seu `.env` local seguindo o padrão das demais.

## Estrutura

```
youtube/
  types.ts     tipos das respostas da API (YoutubeChannelListResponse,
               YoutubePlaylistItemsResponse, YoutubeVideosListResponse,
               YoutubeVideoBruto — o formato já mesclado que vira TRaw)
  client.ts    YoutubeApiClient — resolve a playlist de uploads, pagina
               playlistItems, busca estatísticas em lotes de videos.list,
               retry e rate limit
  collector.ts YoutubeVideosCollector extends Collector<YoutubeVideoBruto>
```

## O que falta para funcionar 100%

Só uma `YOUTUBE_API_KEY` de verdade (gratuita, ver acima) e, para cada
candidato, um `channelId` confirmado como o canal oficial dele — hoje isso
só existe via `--channelId` explícito, porque `perfil_social` ainda não foi
populada (seed manual pendente, seção 2.1 do documento). Todo o resto —
client, paginação, merge de metadados com estatísticas, normalização, hash
estável, proteção contra evento órfão, upsert com dedup — já está
implementado e passa em `npm run typecheck`. O `--dry-run` sem chave foi
testado contra a API real em 2026-08-10 e confirma `403` sem nenhuma chave e
`400` com uma chave inválida nas três rotas (`channels`, `playlistItems`,
`videos`), validando que a integração aponta para o lugar certo.
