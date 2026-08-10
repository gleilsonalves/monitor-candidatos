# Coletor: TCU (Tribunal de Contas da União) — dimensão "Integridade"

Segue o framework descrito em [`../../../README.md`](../../../README.md)
("Como adicionar um novo coletor"). Este documento cobre o que é específico
desta fonte: a API real encontrada (bem diferente do que o documento de
arquitetura original supunha), a decisão de modelagem e a limitação de
entity resolution.

## O que este coletor coleta

Dois cadastros públicos do TCU sobre responsáveis pessoa física:

- **Contas julgadas irregulares** — todo responsável que teve as contas
  julgadas irregulares pelo TCU, com ou sem inabilitação associada.
- **Inabilitados para função pública** — sanção mais grave: inabilitação
  temporária para o exercício de cargo em comissão ou função de confiança na
  administração pública (tem `dataFinalSancao`, o prazo de vigência).

Cada registro vira um `evento` com `tipo='sancao'`, `categoria='controversia'`,
`estagio_juridico=null`, `fonte_confianca=1`.

## A API real — bem diferente do que o documento supunha

O documento de arquitetura (`projeto-monitor-candidatos.md`, seção 2.1) lista
`contas.tcu.gov.br/ords/` como o endpoint do TCU, supondo Oracle ORDS "REST
sobre views de dados abertos". Isso foi checado empiricamente (requisições
reais em 2026-08-10) e a API que efetivamente atende as consultas de
responsáveis por CPF/CNPJ **não vive nesse domínio**:

- **`contas.tcu.gov.br/ords/`** — não foi encontrado nenhum recurso REST
  público documentado diretamente sob esse caminho para consulta de
  responsáveis. O ORDS existe na infraestrutura do TCU (mencionado em
  material institucional), mas os webservices públicos e documentados hoje
  vivem em subdomínios `*.apps.tcu.gov.br` (ver abaixo).
- **`portal.tcu.gov.br/dados-abertos`** (hoje redirecionado para
  `sites.tcu.gov.br/dados-abertos/`) é o portal humano de dados abertos: link
  para bases em CSV/planilha para download em massa, mais uma página
  ["Webservices TCU"](https://sites.tcu.gov.br/dados-abertos/webservices-tcu/)
  que documenta os REST endpoints de verdade.
- A página de listas
  (["Lista de responsáveis com contas julgadas irregulares"](https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares))
  é só uma landing page institucional — não expõe API ali, só explica o que
  as listas significam e aponta para downloads em massa.

**Os endpoints REST reais, confirmados com requisições reais (não supostos)**:

```
POST https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-contas-irregulares
POST https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-inabilitados
```

Corpo da requisição (JSON): `{"cpf": "<cpf com ou sem máscara>"}` — a API
aceita filtro por `parteNome`, `cpf`, `cnpj` (só no primeiro endpoint), `uf` e
`municipio`, mas este coletor usa **só `cpf`** (ver "Entity resolution"
abaixo). Confirmado com uma chamada real:

```
$ curl -s -X POST "https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-inabilitados" \
    -H "Content-Type: application/json" -d '{"cpf":"67034144320"}'
[{"numeroProcessoFormatado":"040.535/2021-5","nome":"ADAM LUCAS COSTA DA SILVA",
  "tipoRegistro":"CPF","numeroRegistro":"670.341.443-20","municipio":"IMPERATRIZ","uf":"MA",
  "numeroAcordaoFormatado":"961/2024-PL","dataAcordao":"15/05/2024",
  "dataTransitoEmJulgado":"23/04/2025","dataFinalSancao":"23/04/2030",
  "linkDeliberacoesProcesso":"https://contas.tcu.gov.br/pesquisaJurisprudencia/#/resultado/...",
  "linkAcompanhamentoProcesso":"https://conecta-tcu.apps.tcu.gov.br/tvp/69264992",
  "codigoProcesso":69264992,"seProcessoGestao":"S"}]
```

`200 OK`, JSON de verdade, **sem nenhuma chave/autenticação** — é dado
público, exatamente como o documento de arquitetura previa (mesmo com o
domínio errado). O CPF é aceito tanto formatado (`670.341.443-20`) quanto só
dígitos (`67034144320`) — testado nos dois formatos, resultado idêntico.

**Achado de segurança importante, documentado para quem for mexer neste
client**: os dois endpoints **não paginam e não exigem filtro**. Um `POST`
com corpo `{}` retornou o cadastro nacional inteiro de inabilitados
(~410KB, milhares de registros) numa única resposta. Por isso
`client.ts` **sempre** envia `cpf` no corpo — nunca chama sem filtro.

Também existe um terceiro endpoint de acórdãos em geral,
`GET https://dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos?inicio=0&quantidade=N`
(confirmado, retorna JSON com `numeroAcordao`, `relator`, `colegiado`,
`urlAcordao` etc.), mas ele **não aceita filtro por responsável/CPF/nome** —
só paginação (`inicio`/`quantidade`) sobre a lista cronológica de todos os
acórdãos do TCU. Usá-lo exigiria varrer o acervo inteiro e tentar casar o
texto do acórdão com o candidato — exatamente o tipo de match fuzzy que a
seção 5 do documento proíbe para eventos de `categoria='controversia'`. Por
isso este coletor **não usa** esse endpoint; ficou de fora do escopo.

Não existe OpenAPI/Swagger publicado para os endpoints de `certidoes.apps.tcu.gov.br`
(diferente do Portal da Transparência) — os tipos em `types.ts` refletem só
o que foi observado em respostas reais.

## Modelagem — por que `tipo='sancao'`, não `'processo'`

Um acórdão do TCU julgando contas irregulares (ou aplicando inabilitação) é
um **achado de tribunal de contas** — natureza administrativa/fiscal sobre a
correta aplicação de recursos públicos. **Não é** um processo da Justiça
comum, eleitoral ou criminal (denúncia, ação penal, condenação...), que é
exatamente o que o enum `estagio_juridico` modela (seção 1 do documento de
arquitetura: "denúncia, investigação_aberta, ação_recebida,
condenação_1a_instância, condenação_colegiado, trânsito_julgado, arquivado,
absolvido" — todos estágios de processo judicial).

Colapsar os dois seria exatamente a confusão que a seção 1 do documento pede
para nunca deixar acontecer: "TCU julgou as contas irregulares" e "condenado
criminalmente" são fatos de natureza, gravidade e instância completamente
diferentes, e tratar um como o outro é o tipo de erro que alimenta a
acusação de difamação (seção 9).

Por isso este coletor grava:

- `tipo = 'sancao'` (não `'processo'`)
- `categoria = 'controversia'`
- `estagio_juridico = null` — só é permitido preencher quando
  `tipo='processo'`; o CHECK constraint do banco
  (`db/migrations/0001_core_schema.sql`) rejeita o insert/update se
  tentarmos preencher aqui.

Mesma decisão de modelagem do coletor do Portal da Transparência
(`../transparencia/collector.ts`), aplicada à mesma razão.

## Entity resolution — a limitação real encontrada

Este é o ponto que mais diverge dos coletores da Câmara e do Portal da
Transparência, e por isso a CLI deste coletor usa `--candidatoId` (o UUID de
`candidato.id`) em vez de `--idCamara`.

Os webservices do TCU só aceitam busca por `parteNome`, `cpf`/`cnpj`, `uf` ou
`municipio` — **não existe nenhum ID interno do candidato** (como
`id_camara`, que a Câmara e o Portal da Transparência usam como chave
determinística de partida) que a API do TCU reconheça. Além disso, muitos
candidatos relevantes para este projeto (ex: candidatos à Presidência sem
mandato na Câmara dos Deputados) sequer têm `id_camara` preenchido em
`candidato` — usar esse campo como ponte, como fazem os outros dois
coletores, deixaria o TCU fora do alcance justamente para os candidatos mais
importantes.

A resolução aqui acontece em duas partes, **ambas determinísticas, nenhuma
fuzzy**:

1. **`candidato_id`** (UUID, chave primária de `candidato`) é fornecido
   **diretamente pelo operador** via `--candidatoId`. `prepare()` só
   **confirma** que esse UUID existe na tabela (protege contra erro de
   digitação / evento órfão) — não faz nenhuma resolução por nome ou
   heurística. Confiança 1.0 por definição: é a própria chave primária.
2. **CPF em claro usado na consulta à API**: vem de `--cpf`, exatamente como
   no coletor do Portal da Transparência (`../transparencia/README.md`) —
   nunca lido do banco (`cpf_hash` é um hash unidirecional, por LGPD — seção
   9 do documento), nunca persistido (o `raw_payload` gravado é a resposta
   da API, que já vem com o CPF mascarado em `numeroRegistro`, não o CPF de
   entrada).

Como camada extra de proteção, `normalize()` em `collector.ts`:

- descarta qualquer registro com `tipoRegistro !== 'CPF'` (os dois cadastros
  do TCU misturam pessoa física e jurídica na mesma lista de resposta; nunca
  atribuímos uma sanção de empresa a um candidato);
- confere que o `numeroRegistro` devolvido pela API bate, dígito a dígito,
  com o `cpf` consultado, antes de gerar qualquer evento — mesmo já
  filtrando por `cpf` na requisição.

**Nunca** busca por `parteNome` para resolver o candidato — usar isso para
criar um evento `categoria='controversia'` é exatamente o cenário proibido
pela seção 5 do documento ("nunca deixar match fuzzy alimentar métrica
direto... é o pior bug possível deste sistema"). Homônimos são comuns em
nomes brasileiros, e o TCU lida com processos envolvendo o Brasil inteiro.

## Toda sanção nasce não revisada — proposital, não bug

Igual ao coletor do Portal da Transparência: todo evento
`categoria='controversia'` nasce com `revisado_humano=false` (`DEFAULT` da
coluna). A policy de RLS de leitura pública
(`db/migrations/0001_core_schema.sql`) só libera `controversia` quando
`revisado_humano = true`. Nenhuma sanção do TCU aparece na leitura pública
até alguém revisar manualmente — mitigação principal contra o maior risco
deste projeto (difamação, seção 9).

## Rodando

```bash
npm install

# 1) Validar fetch/normalize contra a API real do TCU, SEM gravar no banco
#    e SEM precisar de SUPABASE_SERVICE_ROLE_KEY (usa um candidato_id
#    placeholder se --candidatoId não for passado):
npm run collect:tcu -- --cpf=67034144320 --dry-run

# 2) Mesma coisa, mas já com o candidato_id real que vai para o campo
#    candidato_id do JSON normalizado (ainda sem gravar):
npm run collect:tcu -- --candidatoId=11111111-1111-1111-1111-111111111111 --cpf=67034144320 --dry-run

# 3) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY,
#    --candidatoId (UUID já cadastrado em `candidato`) e --cpf são obrigatórios:
npm run collect:tcu -- --candidatoId=11111111-1111-1111-1111-111111111111 --cpf=67034144320
```

`67034144320` (670.341.443-20) acima é um CPF real que aparece nos dois
cadastros do TCU (contas irregulares e inabilitados) para um responsável
público qualquer — usado só para confirmar que o parsing funciona contra
dado real; não corresponde a nenhum candidato deste banco. Validado em
2026-08-10: o `--dry-run` acima retorna 2 registros reais (um de cada
cadastro), ambos do mesmo processo (`040.535/2021-5`), com `data_evento`,
`titulo`, `resumo` e `fonte_url` corretamente montados a partir da resposta
real da API.

Se `--candidatoId` não existir na tabela `candidato` numa execução real
(não `--dry-run`), o coletor loga um aviso e encerra sem gravar nada — igual
aos outros coletores, nenhum evento órfão é inserido.

## Variáveis de ambiente (`.env`, neste pacote)

- `TCU_CERTIDOES_API_BASE` — opcional, já vem com o default
  `https://certidoes.apps.tcu.gov.br/api/publico`. Não precisou ser
  adicionada ao `.env.example` porque tem um default funcional e público —
  só existe a variável para permitir apontar para outro ambiente se um dia
  for necessário.
- **Não existe** `TCU_ID_CANDIDATO` nem equivalente — o `candidato_id` só
  existe como `--candidatoId` na linha de comando, de propósito (mesmo
  raciocínio do Portal da Transparência para não deixar CPF sentado num
  `.env` que poderia ser commitado por engano; aqui o motivo é não haver
  chave externa nenhuma para resolver automaticamente).
- **Não existe** variável de ambiente para o CPF — só `--cpf` na linha de
  comando (ver "Entity resolution" acima).

## Estrutura

```
tcu/
  types.ts     tipos observados nas respostas reais de certidoes.apps.tcu.gov.br
               (ResponsavelSancaoTcuDTO, RegistroTcu, RegistroTcuBruto)
  client.ts    TcuCertidoesApiClient — busca por CPF nos dois cadastros
               (contas irregulares, inabilitados), sem paginação (a API não
               pagina), retry, rate limit
  collector.ts TcuIntegridadeCollector extends Collector<RegistroTcuBruto>
```

## O que falta para funcionar 100%

Nada em termos de acesso à API — é pública, sem chave, validada com
requisições reais (ver acima). O único "falta" é operacional, igual ao
Portal da Transparência: para cada candidato real, alguém precisa fornecer o
CPF (fonte externa confiável, ex: o próprio registro de candidatura no TSE)
na hora de rodar a coleta — este banco não guarda CPF em claro, de propósito
(LGPD, seção 9 do documento). Todo o resto — os dois clients, normalização,
hash estável, proteção contra pessoa jurídica, proteção contra CPF
divergente, `fonte_url`, upsert com dedup — está implementado e passa em
`npm run typecheck`.
