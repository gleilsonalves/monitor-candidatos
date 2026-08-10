# Coletor do TSE (DivulgaCand)

Coleta registro de candidatura e bens declarados a partir da API pública do
TSE. Ver [`../../../README.md`](../../../README.md) para o framework de
coletores em geral (pipeline, `Collector<TRaw>`, como rodar) — este arquivo
documenta só as decisões específicas desta fonte, conforme pedido no
levantamento que originou este coletor.

## Endpoints usados

A API pública e sem chave usada aqui é a que alimenta o próprio site
`divulgacandcontas.tse.jus.br` — **não** é a mesma coisa que
`dadosabertos.tse.jus.br` (que distribui os mesmos dados em CSVs zipados por
ano/UF, sem query por candidato). Os dois portais existem e ambos foram
avaliados; a API REST foi escolhida por permitir buscar só os candidatos
relevantes (nossos 8 candidatos seed) em vez de baixar e parsear ~1-7MB de
CSV por ano cobrindo o Brasil inteiro para depois descartar quase tudo.

Essa API REST não tem documentação pública formal — os endpoints abaixo
foram descobertos inspecionando, com o Chrome DevTools, as chamadas de rede
feitas pelo próprio site oficial ao navegar por ele manualmente (região →
UF → lista de candidatos → perfil de um candidato), e confirmados com
`curl` contra respostas reais antes de escrever qualquer parser.

Base: `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`

| Endpoint | Uso |
|---|---|
| `GET /eleicao/ordinarias` | Lista todas as eleições ordinárias conhecidas (uma por ano/abrangência), cada uma com um `id` interno opaco (ex: `20322002026`). Usado para resolver esse `idEleicao` a partir só do ano informado (`tipoAbrangencia === "F"` = Eleição Geral Federal). Não dá para derivar esse ID de outra forma. |
| `GET /candidatura/cargos?ano={ano}&idEleicao={idEleicao}` | Lista os cargos válidos (Presidente=1, Governador=3, Senador=5, Deputado Federal=6, Deputado Estadual=7, ...) com nome e código. Usado para mapear `candidato.cargo_pretendido` (texto livre, ex: `"Deputado Federal"`) para o código numérico exigido pelos outros endpoints, sem cravar códigos manualmente no código-fonte. |
| `GET /candidatura/listar/{ano}/{uf}/{idEleicao}/{cargo}/candidatos` | Lista as candidaturas de uma UF+cargo (ex: todos os candidatos a Deputado Federal no AM em 2026). Não inclui bens declarados. Usado só para achar, por nome, o candidato certo antes de buscar o detalhe completo. |
| `GET /candidatura/buscar/{ano}/{uf}/{idEleicao}/candidato/{idCandidato}` | Detalhe completo de uma candidatura: situação, partido, coligação/federação, número, data da última atualização e **bens declarados** (`bens[]` + `totalDeBens`). Só chamado para candidatos já resolvidos por nome — não para todo mundo da listagem. |

`idCandidato` é o `SQ_CANDIDATO` do TSE — é ele que vira `candidato.id_tse`
quando o match forte resolve um candidato.

### Página pública (`fonte_url`)

`fonte_url` aponta para a página humana do DivulgaCand (não para o endpoint
JSON), no formato:

```
https://divulgacandcontas.tse.jus.br/divulga/#/candidato/{REGIAO}/{UF}/{idEleicao}/{idCandidato}/{ano}/{UF}
```

`REGIAO` (`NORTE`/`NORDESTE`/`CENTROOESTE`/`SUDESTE`/`SUL`) é derivada da UF
em `match.ts` (`regiaoParaUf`). Essa rota também foi descoberta inspecionando
o app Angular do TSE (`grep` nos bundles JS por `path:` de rotas) e
confirmada navegando até ela e vendo o registro correto renderizar.

## Ano usado e disponibilidade dos dados

Este coletor foi escrito em **10/08/2026**. A eleição geral de 2026 (turno
único em 04/10/2026) já tinha candidaturas registradas nessa data — o
período de registro de candidaturas estava em andamento, não fechado
(fecha por volta de meados de agosto). Isso foi validado na prática, não
assumido: em 10/08/2026 o TSE já reportava **5.025 candidaturas a Deputado
Federal** registradas nacionalmente, e 5 dos 8 candidatos seed já tinham
candidatura 2026 localizável por nome+UF+partido (Adail Filho/AM/MDB,
Adriana Ventura/SP/NOVO, Adriano do Baldy/GO/PP, Afonso Florence/BA/PT,
Adolfo Viana/BA/PSDB). Os outros 3 (Acácio Favacho, Adilson Barroso, Aécio
Neves) não retornaram match — ver seção seguinte, é comportamento esperado
e correto, não um bug.

Por isso o **default do coletor é `--ano=2026`** (também configurável via
`TSE_ANO_ELEICAO` ou `--ano=<ano>`), e não 2022. Dito isso, o coletor foi
testado explicitamente contra `--ano=2022` também (ciclo completo, ex:
Afonso Florence/BA/PT retorna `situação=Deferido`,
`totalização=Eleito por QP`, com data de atualização de 2023) para provar
que a parametrização por ano funciona ponta a ponta em dados completos, não
só nos parciais de 2026.

Como o registro de candidaturas 2026 ainda está em andamento na data desta
implementação, é esperado que **novos candidatos apareçam e situações
mudem** (`Aguardando julgamento` → `Deferido`/`Indeferido`, etc.) em
execuções futuras — o upsert por `hash_conteudo` (chave =
`tipo|candidato_id|tse|ano|idCandidato`, não o conteúdo da situação) garante
que isso vira uma atualização do mesmo evento, não um evento duplicado.

## Entity resolution (seção 5 do documento de arquitetura)

Nenhum dos 8 candidatos seed tem `id_tse` preenchido — só `id_camara` (foram
populados a partir da API da Câmara). O match determinístico do passo 1
(CPF/id_tse) não se aplica na primeira execução. Este coletor implementa o
**passo 2 — match forte**: nome normalizado (sem acento, sem preposição,
maiúsculas) + UF + partido, confiança ~0.9. Implementado em `match.ts`
(`normalizarNome`, `normalizarSigla`) e usado em `collector.ts#fetchAll()`.

Regras aplicadas, sem exceção:

- **Zero matches** → loga e pula. Não gera evento algum para esse candidato
  nesta execução (ex: Acácio Favacho e Aécio Neves em 2026 — ainda não
  registraram candidatura, ou pelo menos não sob esse nome/UF/partido).
- **Mais de um match** (nome normalizado + UF + partido batendo em mais de
  uma candidatura) → loga como **ambíguo** e pula. Nunca escolhe "o primeiro"
  ou "o mais parecido" — é exatamente o cenário que a seção 5 do documento
  proíbe.
- **Match "quase certo" mas não exato** → também pula, propositalmente. Caso
  real encontrado na validação: "Adilson Barroso" (seed) vs "ADILSON BARROSO
  BOLSONARISTA" (nome de urna real da candidatura 2026, mesmo UF/SP e mesmo
  partido/PL) não é considerado match — a comparação é igualdade estrita
  entre nomes normalizados, não substring/fuzzy. Isso é o passo 3 da
  cascata (Levenshtein/Jaro-Winkler), que este coletor **não** implementa —
  fica pra quando houver fila de revisão humana (seção 5, passo 4). Um match
  forte errado é pior que nenhum match.
- **Match único e exato** → resolve, gera o(s) evento(s), e se
  `candidato.id_tse` ainda estiver `NULL`, grava
  `UPDATE candidato SET id_tse = <SQ_CANDIDATO>` (enriquecimento de
  identidade — não é uma métrica do produto). Isso não muda o comportamento
  da *próxima* execução deste coletor (que ainda busca por UF/cargo, não por
  id_tse — ver limitação abaixo), mas deixa a tabela `candidato` mais
  completa para outras fontes/consultas que dependam de `id_tse`.

**Limitação conhecida:** como a API do TSE não tem "buscar candidatura pelo
SQ_CANDIDATO direto, sem saber a UF/eleição", mesmo depois de gravar
`id_tse` este coletor continua refazendo o match por nome a cada execução
(ele já sabe a UF de `candidato.uf`, então a chamada de `/candidatura/buscar`
final poderia pular a etapa de listagem+match se `id_tse` já estiver
setado — não implementado por ora, é uma otimização futura, não um problema
de corretude).

## Modelagem em `evento`

O enum `tipo` do banco (`proposicao | voto | processo | sancao | despesa |
nomeacao | post | anuncio`) não tem um valor para "registro de candidatura"
nem para "bens declarados" — e não dá pra inventar um novo valor (CHECK
constraint). Decisão pragmática: os dois usam **`tipo='nomeacao'` +
`categoria='neutro'`**. `nomeacao` foi escolhido por ser, dos oito valores
existentes, o mais próximo semanticamente de "ato oficial formal que investe
alguém numa posição/disputa" — candidatura registrada e deferida pela
Justiça Eleitoral tem esse caráter. `categoria='neutro'` porque nem
registrar candidatura nem declarar bens é, por si só, uma realização ou uma
controvérsia. `estagio_juridico` fica sempre `null` (só se aplica a
`tipo='processo'` — reforçado por CHECK constraint no banco; nenhum dos dois
eventos deste coletor é um processo judicial).

Cada candidato resolvido gera até **dois eventos**, produzidos a partir de
uma única chamada a `/candidatura/buscar` (a API já retorna candidatura +
bens juntos):

| | Candidatura | Bens declarados |
|---|---|---|
| Gerado quando | sempre que há match | só se `bens.length > 0` |
| `titulo` | `"Candidatura a {cargo} {ano} — {partido}/{uf}"` | `"Bens declarados — candidatura {ano} ({partido}/{uf})"` |
| `resumo` | número, coligação/federação (quando distinta do partido isolado), situação, totalização | contagem de itens + valor total declarado, formatado em R$ |
| `data_evento` | `dataUltimaAtualizacao` da candidatura (não a data da eleição nem a data de geração do arquivo — é o dado mais próximo de "quando este fato passou a valer" que a API expõe) | idem |
| `hash_conteudo` | `sha256("nomeacao\|candidatura\|{candidato_id}\|tse\|{ano}\|{idCandidato}")` | `sha256("nomeacao\|bens\|{candidato_id}\|tse\|{ano}\|{idCandidato}")` |

Bens são modelados como **um evento agregado por candidatura**, não um
evento por item declarado — um candidato pode declarar dezenas de bens
pequenos, e um evento por item poluiria a timeline sem agregar muito valor
informativo nesta fase. Os itens individuais (`bens[]`, com descrição, tipo
e valor) estão disponíveis em `raw_payload` para quem precisar do detalhe.

## Diferença estrutural em relação ao coletor da Câmara

A Câmara é uma API por-deputado: um `idCamara` → as proposições daquele
deputado. `prepare()` resolve um único `candidato_id` determinístico antes
de buscar qualquer coisa, e a CLI roda um deputado por vez
(`--idCamara=<id>`).

O TSE não tem um endpoint "candidatura de uma pessoa específica"
independente de UF/cargo/ano — os dados vêm agrupados por UF+cargo. Por
isso este coletor processa **a tabela `candidato` inteira numa única
execução**: `prepare()` carrega todos os candidatos com dado suficiente
(uf, partido, nome, cargo mapeável) e resolve o cargo do TSE para cada um;
`fetchAll()` agrupa por (UF, cargo) pra minimizar chamadas de listagem e
faz o match forte por candidato dentro de cada grupo. A CLI reflete isso:
não existe `--idCandidato`, só `--ano` (a coleta real não recebe um alvo
específico — roda para todos os candidatos elegíveis de uma vez). O
`--dry-run`, por não ter acesso à tabela `candidato`, aceita
`--nomeUrna`/`--uf`/`--partido`/`--cargo` para inspecionar um alvo
sintético sem banco.

## Como testar

```bash
# validar fetch/normalize contra a API real do TSE, sem gravar no banco e
# sem SUPABASE_SERVICE_ROLE_KEY — usa "Adail Filho" (AM/MDB) como amostra
# default, confirmado com candidatura 2026 registrada:
npm run collect:tse -- --dry-run

# outro candidato/ano:
npm run collect:tse -- --dry-run --nomeUrna="Afonso Florence" --uf=BA --partido=PT --ano=2022

# coleta de verdade (roda para todos os 8 candidatos seed, grava no banco) —
# precisa de SUPABASE_SERVICE_ROLE_KEY (ver README principal):
npm run collect:tse -- --ano=2026
```

### Variáveis de ambiente específicas (opcionais)

- `TSE_API_BASE` — default `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`.
- `TSE_ANO_ELEICAO` — default `2026` quando `--ano` não é passado.

(Nenhuma delas precisa ser adicionada a `.env.example` para o coletor
funcionar — os defaults já cobrem o uso normal.)
