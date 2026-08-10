# Coletor: Meta Ad Library — "Investimento em propaganda"

Segue o framework descrito em [`../../../README.md`](../../../README.md)
("Como adicionar um novo coletor"). Este documento cobre o que é específico
desta fonte: a API real, como conseguir o token, a limitação de entity
resolution, e — o ponto mais importante para quem for ler o dado na tela —
que gasto e alcance vêm sempre como **faixa**, nunca como número exato.

## O que este coletor coleta

Anúncios políticos/de interesse público arquivados na Meta Ad Library
(`graph.facebook.com/<versão>/ads_archive`), para a dimensão "Investimento em
propaganda" (seção 6 do documento de arquitetura:
[`../../../../../projeto-monitor-candidatos.md`](../../../../../projeto-monitor-candidatos.md)).
Cada anúncio vira um `evento` com `tipo='anuncio'`, `categoria='neutro'`
(investir em propaganda não é por si só realização nem controvérsia — é fato
de campanha), `estagio_juridico=null`, `fonte_confianca=1`.

## Endpoint exato e parâmetros usados

```
GET https://graph.facebook.com/v24.0/ads_archive
  ?ad_type=POLITICAL_AND_ISSUE_ADS
  &ad_reached_countries=["BR"]
  &search_page_ids=["<pageId>"]
  &ad_active_status=ALL
  &fields=id,page_id,page_name,ad_creation_time,ad_delivery_start_time,
          ad_delivery_stop_time,ad_snapshot_url,ad_creative_bodies,
          ad_creative_link_captions,ad_creative_link_titles,bylines,
          currency,spend,impressions,publisher_platforms
  &limit=100
  &access_token=<token>
```

Confirmado contra a documentação oficial em
<https://developers.facebook.com/docs/graph-api/reference/ads_archive/>
(consultada em 2026-08-10, versão de doc então em v26.0 da Graph API):

- `ad_reached_countries` é **obrigatório em toda chamada** ao endpoint, não
  só para anúncios políticos — a API rejeita a requisição sem ele (ver
  validação abaixo). Usamos `["BR"]` fixo (o projeto é sobre política
  brasileira).
- `ad_type=POLITICAL_AND_ISSUE_ADS` é o que garante que a resposta traga
  `spend`/`impressions` — esses dois campos só são populados para essa
  categoria (e para anúncios da UE/Reino Unido, fora do escopo daqui). Para
  anúncios comerciais comuns (`ad_type=ALL`), a API retorna `spend: null`.
- `search_page_ids` (array de até 10 IDs) é o parâmetro de busca usado — ver
  seção "Entity resolution" abaixo para o porquê.
- `ad_active_status=ALL` inclui anúncios já encerrados, não só os ativos no
  momento da coleta — um anúncio de campanha que já parou de veicular ainda
  é um fato relevante de investimento em propaganda, não deveria desaparecer
  da coleta só porque não está mais no ar.
- A versão `v24.0` foi escolhida por não retornar o header de depreciação
  `x-ad-api-version-warning` (`v21`–`v23` retornam; testado em 2026-08-10 —
  ver seção seguinte). Configurável via `META_ADS_API_BASE`.

`client.ts` implementa a paginação via `paging.next` (URL completa retornada
pela própria API, igual ao padrão `rel=next` da Câmara, só que aqui é um
campo JSON em vez de um header de link).

## Ranges, não valores exatos — isso precisa estar visível pro usuário final

**A Meta nunca publica o gasto exato nem o alcance exato de um anúncio
político.** Os campos `spend` e `impressions` vêm como um objeto
`{lower_bound, upper_bound}` (ex: `{"lower_bound": "100", "upper_bound":
"499"}`, ou sem `upper_bound` quando a faixa é aberta no topo — o maior
bucket). Isso é uma política deliberada de privacidade da Meta, documentada
oficialmente, não uma limitação deste coletor.

Por isso `normalize()` (`collector.ts`, função `montarResumo`) **nunca**
converte a faixa num número único (nem média, nem limite inferior sozinho) —
o `resumo` do evento sempre expõe o range por extenso, ex.:

> "Gasto declarado (faixa): 100–499 BRL. Alcance estimado (faixa de
> impressões): 1000–4999. Veiculado em: facebook, instagram. Faixas
> estimadas pela própria Meta — não são valores exatos."

Quando a API não retorna `spend`/`impressions` para um anúncio específico
(acontece — cobertura de dado incompleto é documentada pela própria Meta,
não um bug deste coletor), o resumo declara isso explicitamente ("não
informado pela API para este anúncio") em vez de omitir o campo em silêncio,
o que poderia ser lido como "gasto zero".

**Consequência para quem for consumir isso na API/frontend**: qualquer
métrica agregada calculada a partir de `evento.tipo='anuncio'` (ex:
`metrica.chave = 'gasto_ads_brl'`, seção 4 do documento) herda essa
imprecisão. Se a camada de métricas somar faixas de vários anúncios, o
resultado é uma soma de faixas (ou, na melhor das hipóteses, uma faixa
"mínimo agregado – máximo agregado"), nunca um total exato — isso precisa
ficar visível na UI (ex: "R$ 12.000–48.000", nunca "R$ 30.000" como se fosse
precisão real). Este coletor não computa essa agregação (fica para o job de
`compute:metricas`, fora do escopo aqui); só garante que a granularidade
"faixa, não valor" chega intacta até o `evento.resumo`.

## Como conseguir o próprio access_token

Este ambiente **não tem** um token válido — não foi possível ver dados reais
durante a implementação. O processo para conseguir um, segundo a
documentação oficial (<https://developers.facebook.com/docs/graph-api/reference/ads_archive/>
e <https://www.facebook.com/ID/ads_library>, que descreve o fluxo de acesso
a anúncios políticos):

1. Ter uma **conta de desenvolvedor Meta verificada** —
   <https://developers.facebook.com/docs/development/release/authentication-and-authorization>
   — que exige confirmação de identidade (documento oficial + selfie, no
   fluxo atual da Meta) e, para acesso a anúncios políticos/de interesse
   público especificamente, confirmação adicional de que o uso é para fins
   de pesquisa/transparência (não é aprovação automática).
2. Criar um app no <https://developers.facebook.com/apps/> e solicitar a
   permissão relacionada ao acesso à Ad Library de anúncios políticos
   (`ads_read` / acesso ao endpoint `ads_archive` para
   `POLITICAL_AND_ISSUE_ADS` — a nomenclatura exata da permissão muda entre
   versões da plataforma; confirmar no App Dashboard no momento do cadastro).
3. Gerar um **token de longa duração** (não um token de usuário de curta
   duração, que expira em horas) — token de app ou token de página, a
   depender de como o app foi aprovado.
4. Colar em `META_ADS_ACCESS_TOKEN` no `.env` deste pacote
   (`packages/workers/.env` — copie de `.env.example` se ainda não existir).
   **Este projeto não modificou `.env.example`** (fora do escopo desta
   tarefa) — a variável ainda precisa ser adicionada lá por quem tiver o
   token em mãos, ou basta exportá-la no ambiente antes de rodar o comando.

Este processo de verificação **não é trivial** (é o principal motivo de
`admapix`/`swipekit`/outros guias de mercado tratarem acesso político como
"significativamente mais difícil" que acesso comercial padrão) — não foi
tentado aqui, só confirmado via documentação e requisição real sem token.

## Endpoint exato e validação sem token

Sem `access_token`, quatro requisições reais (feitas em 2026-08-10) mostram
exatamente o que a API responde, e por que isso prova que a rota está
correta mesmo sem poder ver dados:

**1) Rota real, parâmetro obrigatório ausente (sem token, sem
`ad_reached_countries`)** — confirma que a API *reconhece* o endpoint e
valida seus próprios parâmetros antes mesmo de checar o token:

```
$ curl -s -i "https://graph.facebook.com/v21.0/ads_archive"
HTTP/1.1 400 Bad Request
{"error":{"message":"(#100) The parameter ad_reached_countries is required.","type":"OAuthException","code":100,...}}
```

**2) Rota real, parâmetros válidos, mas sem `access_token`** — a Graph API
tem um comportamento inconsistente aqui: em vez do 400 clássico "an access
token is required", este endpoint específico devolve um 500 genérico:

```
$ curl -s -i "https://graph.facebook.com/v21.0/ads_archive?ad_type=POLITICAL_AND_ISSUE_ADS&ad_reached_countries=%5B%22BR%22%5D&search_terms=candidato"
HTTP/1.1 500 Internal Server Error
{"error":{"message":"An unknown error has occurred.","type":"OAuthException","code":1,...}}
```

O modo `--dry-run` deste coletor sem `META_ADS_ACCESS_TOKEN` reproduz
exatamente esse caso (2) — ver "Rodando" abaixo. Testado e confirmado
rodando o próprio comando: `endpoint_validado: true, status_http: 500`.

**3) Rota real, `access_token` presente mas inválido** — aqui sim vem o 400
OAuth clássico, o que prova que a API processa o parâmetro `access_token`
normalmente quando ele existe:

```
$ curl -s -i "https://graph.facebook.com/v21.0/ads_archive?ad_reached_countries=%5B%22BR%22%5D&access_token=INVALID"
HTTP/1.1 400 Bad Request
{"error":{"message":"Invalid OAuth access token - Cannot parse access token","type":"OAuthException","code":190,...}}
```

**4) Contraste — rota INEXISTENTE, para provar que os erros acima não são
"rota errada" disfarçada**:

```
$ curl -s -i "https://graph.facebook.com/v21.0/ads_archive_bogus_endpoint_xyz?ad_reached_countries=%5B%22BR%22%5D"
HTTP/1.1 400 Bad Request
{"error":{"message":"Unsupported get request. Object with ID 'ads_archive_bogus_endpoint_xyz' does not exist, cannot be loaded due to missing permissions, or does not support this operation. ...","type":"OAuthException","code":100,...}}
```

A mensagem de (4) é categoricamente diferente das de (1)-(3) — "Object with
ID '...' does not exist" é o erro que a Graph API dá para um nó/edge que não
existe. Nenhuma das quatro respostas é um `404` HTTP puro (a Graph API
sempre embrulha erro em `200`/`4xx`/`5xx` com corpo `{"error": {...}}`), mas
a diferença de mensagem entre (1)-(3) (reconhece `ads_archive`, valida seus
parâmetros, processa `access_token`) e (4) (não reconhece o objeto) é a
prova de que `/ads_archive` com os parâmetros que este client monta
(`ad_type`, `ad_reached_countries`, `search_page_ids`, `ad_active_status`,
`fields`) é a rota certa — o único bloqueio real é não ter um
`META_ADS_ACCESS_TOKEN` válido.

## Entity resolution — search_page_ids, não search_terms

A API oferece dois jeitos de buscar anúncios de um anunciante específico:

- **`search_page_ids`** — array de até 10 IDs de página do Facebook.
  Determinístico: ou o `page_id` é o do candidato, ou não é. Nenhuma
  ambiguidade de nome envolvida.
- **`search_terms`** — busca textual livre no conteúdo do anúncio (não no
  nome do anunciante). Pode retornar anúncios de qualquer página cujo texto
  bata com o termo — incluindo paródia, crítica, homônimo, ou terceiros
  citando o nome do candidato sem serem o candidato.

Este coletor **implementa apenas `search_page_ids`** e **não implementa
`search_terms`**, de propósito. Isso segue a mesma regra que já vale para o
coletor do Portal da Transparência (`../transparencia/README.md`, seção
"Entity resolution") e a seção 5 do documento de arquitetura: "nunca deixar
match fuzzy alimentar métrica direto... é o pior bug possível deste
sistema". Buscar por `search_terms` é exatamente esse cenário — atribuir a
um candidato um anúncio pago por outra pessoa (inclusive um adversário
fazendo propaganda negativa, ou uma paródia) na dimensão "investimento em
propaganda" seria um erro editorialmente grave, não só tecnicamente.

**O `pageId` é fornecido pelo operador via `--pageId`, nunca inferido.** O
schema atual (`db/migrations/0001_core_schema.sql`) tem uma tabela
`perfil_social` com `plataforma='facebook'` e `handle`/`url`, mas nenhuma
delas guarda o **Page ID numérico** que a Graph API exige (o `handle`/`url`
de uma página não é o `page_id`; resolver um a partir do outro exigiria uma
chamada adicional à Graph API que também depende de token). Migrar o schema
para acrescentar essa coluna está fora do escopo desta tarefa (só
`src/collectors/meta-ads/` e `src/cli/collectMetaAds.ts` foram tocados) —
por ora, `--pageId` é sempre passado à mão pelo operador a partir de uma
fonte externa confiável (ex: conferir o Page ID direto na página do
Facebook do candidato via `graph.facebook.com/<handle>?fields=id` com um
token válido, ou pela própria URL da Ad Library).

`prepare()` confirma que o `candidatoId` informado existe de fato na tabela
`candidato` antes de buscar qualquer anúncio (mesma postura defensiva do
resto do framework — nunca grava evento órfão), mas **não** valida que o
`pageId` de fato pertence a esse candidato — essa associação continua sendo
uma responsabilidade humana do operador, exatamente como o CPF em
`--cpf` no coletor do Portal da Transparência.

## Rodando

```bash
npm install

# 1) Validar que a rota está correta, SEM token e SEM gravar no banco: faz
#    uma requisição real ao endpoint sem META_ADS_ACCESS_TOKEN e confirma
#    que a resposta é um erro OAuth (400/500 — nunca 404), o que prova que
#    /ads_archive e os parâmetros (ad_type, ad_reached_countries,
#    search_page_ids) estão corretos:
npm run collect:meta-ads -- --candidatoId=00000000-0000-0000-0000-000000000000 --pageId=<pageId> --dry-run

# 2) Com um token real, dry-run mostra fetch/normalize de verdade (ainda sem
#    gravar, ainda sem precisar de SUPABASE_SERVICE_ROLE_KEY):
export META_ADS_ACCESS_TOKEN=EAAxxxxxxxxxxxx   # ou defina no .env deste pacote
npm run collect:meta-ads -- --candidatoId=<uuid-real> --pageId=<pageId> --dry-run

# 3) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY
#    E META_ADS_ACCESS_TOKEN, e candidatoId precisa já existir em `candidato`:
npm run collect:meta-ads -- --candidatoId=<uuid-real> --pageId=<pageId>
```

Se `candidatoId` não existir na tabela `candidato`, o coletor loga um aviso
e encerra sem gravar nada, igual aos demais coletores do framework.

## Variáveis de ambiente

- `META_ADS_ACCESS_TOKEN` — obrigatória para ver dados de verdade (não para
  `--dry-run` sem token, que só valida a rota). Ver "Como conseguir o
  próprio access_token" acima. **Não está em `.env.example`** — fora do
  escopo desta tarefa tocar nesse arquivo; adicione manualmente ao `.env`
  deste pacote ou exporte no ambiente.
- `META_ADS_API_BASE` — opcional, default `https://graph.facebook.com/v24.0`.
- **Não existe** variável de ambiente para `candidatoId` nem `pageId` — só
  argumentos de linha de comando, de propósito (mesma lógica do `--cpf` no
  coletor do Portal da Transparência: nenhuma associação candidato↔página
  deveria ficar sentada silenciosamente num `.env`).

## Estrutura

```
meta-ads/
  types.ts     tipos da resposta do endpoint (MetaAdArchiveItem, MetaAdsRange, ...) —
               confirmados contra a documentação oficial da Graph API
  client.ts    MetaAdsApiClient — busca por search_page_ids, paginação via
               paging.next, retry, rate limit; monta também a URL de
               validação sem token usada pelo --dry-run
  collector.ts MetaAdsCollector extends Collector<MetaAdArchiveItem> —
               entity resolution por candidatoId informado (sem fuzzy match),
               normalize() com faixas de gasto/alcance nunca convertidas em
               valor único
```

## O que falta para funcionar 100%

Só o `META_ADS_ACCESS_TOKEN` de verdade — de um app Meta com conta de
desenvolvedor verificada e acesso aprovado especificamente a anúncios
políticos/de interesse público (processo não trivial, ver seção acima). Todo
o resto — client, paginação via `paging.next`, normalização com faixas
explícitas de gasto/alcance (nunca um número falsamente exato), hash
estável, `fonte_url` a partir de `ad_snapshot_url`, entity resolution
restrita a `search_page_ids`, upsert com dedup — já está implementado e
passa em `npm run typecheck`. O `--dry-run` sem token foi testado contra a
API real em 2026-08-10 (`npm run collect:meta-ads -- --candidatoId=00000000-0000-0000-0000-000000000000 --pageId=123456789 --dry-run`)
e confirma `status_http: 500` com corpo `OAuthException`/`code: 1` — a
mesma assinatura documentada na seção "Endpoint exato e validação sem
token" — validando que a integração aponta para o lugar certo. Nenhum dado
de anúncio real (gasto, alcance, criativo) foi visto ou fabricado durante
esta implementação.
