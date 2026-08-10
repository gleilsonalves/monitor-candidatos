# Coletor: DataJud (CNJ) — processos judiciais

Segue o framework descrito em [`../../../README.md`](../../../README.md)
("Como adicionar um novo coletor"). Este documento cobre o que é específico
desta fonte — de longe a mais sensível do sistema, porque alimenta a tabela
que registra processos judiciais de pessoas reais (ver seções 1, 5 e 9 do
[documento de arquitetura](../../../../../projeto-monitor-candidatos.md)).

**Leia isto inteiro antes de rodar este coletor contra um candidato real.**

## Resumo do que mudou em relação ao design original

A tarefa original previa `npm run collect:datajud -- --candidatoId=<uuid>
--cpf=<cpf>`, no mesmo padrão do coletor do Portal da Transparência
(`src/collectors/transparencia/`). A pesquisa contra a documentação oficial
e uma requisição real (ambas descritas abaixo) mostrou que **isso não é
possível nesta API**: a API Pública do DataJud não tem nenhum campo de nome
ou CPF/CNPJ de parte — nem para busca, nem na resposta. Buscar por CPF é
estruturalmente impossível aqui, não é uma limitação de implementação.

A CLI real deste coletor é:

```
npm run collect:datajud -- --candidatoId=<uuid> --numeroProcesso=<20 dígitos> --tribunal=<alias> [--fonteUrl=<url>] [--dry-run]
```

Ver a seção "Entity resolution" abaixo para a justificativa completa.

## O que este coletor coleta

Metadados de UM processo judicial específico (classe, assuntos, órgão
julgador, movimentações), buscado pelo seu número único, e grava (no máximo)
um `evento` com `tipo='processo'`, `categoria='controversia'`,
`estagio_juridico` mapeado com cautela (ver abaixo), `fonte_confianca=1`.

## O endpoint real, confirmado

A API é um proxy de leitura sobre um cluster **Elasticsearch** (Elastic
Cloud — confirmado pelos headers `X-Found-Handling-Cluster` /
`X-Found-Handling-Instance` numa resposta real, ver abaixo). Documentação
oficial: <https://datajud-wiki.cnj.jus.br/api-publica/>.

```
POST https://api-publica.datajud.cnj.jus.br/api_publica_{tribunal}/_search
Authorization: ApiKey <chave>
Content-Type: application/json

{"query":{"match":{"numeroProcesso":"00008323520184013202"}}}
```

Esse exemplo (URL, headers, corpo e a resposta completa, incluindo um
`movimentos[]` real) está publicado literalmente em
<https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1> (consultado
em 2026-08-10) — é a fonte de `types.ts` e `client.ts` deste coletor.

`{tribunal}` é um dos ~91 aliases confirmados em
<https://datajud-wiki.cnj.jus.br/api-publica/endpoints/> (ex: `tjsp`,
`trf1`, `tse`, `stj`, `trt2`, `tre-sp`) — lista completa em
`client.ts` (`TRIBUNAIS_VALIDOS`).

### A chave de API é PÚBLICA e COMPARTILHADA — não é um cadastro individual

Diferente do Portal da Transparência (que exige e-mail cadastrado + chave
pessoal), o DataJud funciona diferente: "A autenticação da API Pública do
Datajud é realizada através de uma **Chave Pública**, gerada e
disponibilizada pelo DPJ/CNJ" — uma única chave, publicada e mantida
atualizada em <https://datajud-wiki.cnj.jus.br/api-publica/acesso/>, usada
por qualquer consumidor da API. O CNJ pode trocá-la a qualquer momento (por
segurança), então é preciso conferir a chave vigente naquela página antes de
rodar uma coleta real — não há "pegar a chave uma vez e esquecer".

Cole a chave vigente em `DATAJUD_API_KEY` no `.env` deste pacote.

### Validação sem chave — requisição real feita em 2026-08-10

```
$ curl -i -X POST "https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search" \
    -H "Content-Type: application/json" \
    -d '{"query":{"match":{"numeroProcesso":"00000000000000000000"}}}'

HTTP/1.1 401 Unauthorized
Www-Authenticate: Basic realm="security" charset="UTF-8"
Www-Authenticate: Bearer realm="security"
Www-Authenticate: ApiKey
X-Found-Handling-Cluster: ab77d9b257f54e4a8a2761fae16016ee
X-Found-Handling-Instance: instance-0000000003

{"error":{"root_cause":[{"type":"security_exception","reason":"missing authentication credentials for REST request [/api_publica_tjsp/_search]", ...}],"type":"security_exception","reason":"missing authentication credentials for REST request [/api_publica_tjsp/_search]", ...},"status":401}
```

`401`, não `404` — confirma que a rota está correta e que o erro é
literalmente o `security_exception` nativo do Elasticsearch (o
`WWW-Authenticate: ApiKey` no header mostra que o esquema de auth é o
esquema "ApiKey" nativo do Elasticsearch, não algo proprietário do CNJ). O
modo `--dry-run` deste coletor reproduz essa mesma checagem automaticamente
contra o tribunal escolhido (default `tjsp` se `--tribunal` não for
passado).

## Entity resolution — por que isto é diferente de todos os outros coletores

Este é o ponto mais importante deste documento.

### Achado: a API não tem NENHUM campo de parte processual

Confirmado por duas fontes primárias independentes, ambas consultadas em
2026-08-10:

1. **O Glossário de Dados oficial**
   (<https://datajud-wiki.cnj.jus.br/api-publica/glossario/>) lista **todos**
   os atributos indexados: `id`, `tribunal`, `numeroProcesso`,
   `dataAjuizamento`, `grau`, `nivelSigilo`, `formato`, `sistema`, `classe`,
   `assuntos`, `orgaoJulgador`, `movimentos` (com `codigo`, `nome`,
   `dataHora`, `complementosTabelados`), `dataHoraUltimaAtualizacao`,
   `@timestamp`. **Nenhum** é nome, CPF, CNPJ, polo ativo/passivo ou
   advogado.
2. **O exemplo de resposta real** publicado em
   <https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1> (citado
   acima) — o `_source` do documento retornado não tem esse campo.

Isso é proposital, não uma lacuna: fontes secundárias consultadas (ex.
artigos técnicos sobre a API) confirmam que o DataJud "armazena nomes das
partes, mas não indexa CPF/CNPJ diretamente nos campos pesquisáveis da API
pública (por questões de privacidade LGPD)" — e mesmo o nome da parte, que
alguns desses artigos afirmam existir em outro nível do sistema, **não
aparece em nenhum lugar da resposta HTTP real nem do glossário oficial**
consultados aqui. Ou seja: mesmo que a busca por nome existisse em algum
outro canal do DataJud, **este coletor não teria como usá-la nem para
buscar nem para verificar** — a única coisa que a API pública devolve é
metadado processual puro.

### Consequência: `--cpf` não serve pra nada nesta API — trocamos por `--numeroProcesso` + `--tribunal`

A busca é **só por `numeroProcesso`** (`match` no Elasticsearch). O
`numeroProcesso` é a numeração única nacional (Resolução CNJ 65/2008, 20
dígitos, formato `NNNNNNN-DD.AAAA.J.TR.OOOO`) — **1 processo = 1 número**,
sem ambiguidade possível. Isso é, na prática, uma correspondência
determinística ainda mais forte do que um CPF teria sido: não existe
"quase certo" com um numeroProcesso, ele resolve para exatamente um
processo ou para nenhum.

O que ele **não** resolve sozinho é a pergunta "este processo pertence a
este candidato?" — porque a API não devolve nada que permita verificar isso
automaticamente (sem nome, sem CPF, nada). Essa afirmação **tem que vir de
fora**, de uma fonte humana confiável e auditável (ex: uma notícia que cita
o número exato do processo relacionado ao candidato, uma publicação oficial
que nomeia o candidato E o número do processo, ou o próprio candidato
declarando o processo). Por isso:

- `--candidatoId` é o **uuid** do candidato, já existente na tabela
  `candidato` — resolvido em `prepare()` por **PK exata** (`id = :candidatoId`),
  confiança 1.0, mesmo padrão de "aborta sem gravar nada se não existir" dos
  outros coletores.
- `--numeroProcesso` e `--tribunal` são fornecidos pelo operador, **nunca**
  lidos do banco, **nunca** inferidos por nome — são a asserção externa e
  auditável de que "este numeroProcesso corresponde a este candidatoId".
- **Nunca** existe busca por nome ou por CPF neste coletor — nem porque a
  seção 5 do documento de arquitetura proíbe fuzzy match em fontes deste
  tipo, nem porque, tecnicamente, a API nem aceitaria essa busca.
- `--fonteUrl` (opcional, mas recomendado) é o link público **verificado
  manualmente pelo operador** para aquele processo específico no sistema do
  tribunal de origem (e-SAJ, Projudi, PJe, etc — cada tribunal tem o seu,
  sem um padrão universal). Sem ele, o coletor usa um fallback genérico (ver
  `FONTE_URL_FALLBACK_CNJ` em `collector.ts`) que **não** é um link direto
  para o processo — é a página de consulta pública nacional do PJe, onde o
  número ainda precisa ser digitado manualmente. Isso é uma limitação real,
  documentada às claras: não existe, até onde esta pesquisa confirmou, uma
  URL pública universal que resolva direto para qualquer um dos ~91
  tribunais.

## Mapeamento de movimentação (TPU → `estagio_juridico`) — parcial, de propósito

Ver a documentação completa, com a metodologia exata (incluindo os
parâmetros das chamadas feitas) e a justificativa código a código, em
[`mapaMovimentacao.ts`](./mapaMovimentacao.ts). Resumo:

**Fonte**: Sistema de Gestão de Tabelas Processuais Unificadas (SGT) do CNJ,
consulta pública em
<https://www.cnj.jus.br/sgt/consulta_publica_movimentos.php>. É uma UI
antiga baseada em Sajax; os dois códigos abaixo foram obtidos chamando esse
endpoint diretamente (`POST` com `rs=pesquisarItemGetTabela` e
`rs=getDetalhesItem`) em 2026-08-10 — reproduzível por qualquer pessoa.

| Código TPU | Nome confirmado no SGT | `estagio_juridico` |
|---|---|---|
| 848 | Trânsito em julgado (busca sem ambiguidade, resultado único) | `transito_julgado` |
| 246 | Arquivamento > Definitivo (filho de 861 "Arquivamento") | `arquivado` |

Os outros 6 valores do enum (`denuncia`, `investigacao_aberta`,
`acao_recebida`, `condenacao_1a_instancia`, `condenacao_colegiado`,
`absolvido`) **não estão mapeados** — cada um tem um motivo específico
documentado em `mapaMovimentacao.ts` (ambiguidade de nome genérico,
resultado provavelmente codificado em `complementosTabelados` em vez de um
código de movimento próprio, ou estágio que pode nem corresponder a um
`movimento` e sim a uma `classe` processual diferente). **Nenhum desses 6
foi adivinhado.** Um processo cujo movimento mais recente não mapeia para
nenhum desses 2 códigos simplesmente não gera evento — `normalize()` retorna
`null` e o coletor loga o motivo.

Isto é o cumprimento literal da regra desta tarefa: **é melhor não ter o
dado do que classificar errado um estágio jurídico.**

## Toda controvérsia nasce não revisada — proposital, não bug

Igual ao coletor do Portal da Transparência: todo evento
`categoria='controversia'` nasce com `revisado_humano=false` (o `DEFAULT` da
coluna) e só fica visível publicamente depois de revisão humana (policy de
RLS em `db/migrations/0001_core_schema.sql`). Este coletor nunca seta
`revisado_humano` — nem aqui isso seria mais crítico do que em qualquer
outro coletor: processo judicial é o tipo de fato mais sensível do sistema
(seção 9 do documento — risco de difamação).

## Rodando

```bash
npm install

# 1) Validar que a rota está correta, SEM chave e SEM gravar no banco (usa
#    tjsp e um numeroProcesso de teste com dígitos zerados por default):
npm run collect:datajud -- --dry-run

# 2) Com um numeroProcesso e tribunal reais, ainda sem chave (mesma
#    validação, mas mostra o alias do tribunal escolhido no log):
npm run collect:datajud -- --numeroProcesso=0000832-35.2018.4.01.3202 --tribunal=trf1 --dry-run

# 3) Com uma chave real, dry-run mostra fetch/normalize de verdade (ainda
#    sem gravar, ainda sem precisar de SUPABASE_SERVICE_ROLE_KEY):
cp .env.example .env   # preencha DATAJUD_API_KEY (ver "chave pública" acima)
npm run collect:datajud -- --numeroProcesso=0000832-35.2018.4.01.3202 --tribunal=trf1 --dry-run

# 4) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY
#    E DATAJUD_API_KEY, e candidatoId/numeroProcesso/tribunal são obrigatórios:
npm run collect:datajud -- \
  --candidatoId=<uuid-já-existente-em-candidato> \
  --numeroProcesso=0000832-35.2018.4.01.3202 \
  --tribunal=trf1 \
  --fonteUrl="https://.../consulta-publica-do-tribunal-de-origem"
```

Se `candidatoId` não existir na tabela `candidato`, o coletor loga um aviso
e encerra sem gravar nada. Se o `numeroProcesso` não for encontrado no
`tribunal` informado, idem. Se nenhum movimento do processo mapear com
confiança para um `estagio_juridico`, idem — em nenhum desses três casos um
evento é criado.

## Variáveis de ambiente (`.env`, neste pacote)

- `DATAJUD_API_KEY` — obrigatória para coleta real (não para `--dry-run` sem
  chave, que só valida a rota). É a chave PÚBLICA compartilhada do CNJ, ver
  "A chave de API é pública" acima — confira a vigente em
  <https://datajud-wiki.cnj.jus.br/api-publica/acesso/>.
- `DATAJUD_API_BASE` — opcional, já vem com o default
  `https://api-publica.datajud.cnj.jus.br`.
- **Não existe** variável de ambiente para `numeroProcesso`, `tribunal` ou
  `candidatoId` — só argumentos de linha de comando, de propósito (mesmo
  raciocínio do `--cpf` no coletor do Portal da Transparência: são
  asserções pontuais e auditáveis, não configuração persistente).

## Estrutura

```
datajud/
  types.ts              tipos da API (DatajudProcesso, DatajudMovimento, ...) — confirmados
                         contra o glossário oficial e o exemplo de resposta real
  mapaMovimentacao.ts    tradução PARCIAL e conservadora de código TPU → estagio_juridico,
                         com a metodologia exata e a justificativa de cada código (mapeado
                         ou não) documentadas linha a linha
  client.ts              DatajudApiClient — busca por numeroProcesso, valida tribunal e
                         formato do número antes de chamar a API
  collector.ts           DatajudProcessoCollector extends Collector<DatajudProcessoBruto>
```

## O que falta para funcionar 100%

Só a `DATAJUD_API_KEY` vigente (pública, ver acima) e, para cada execução
real, um `numeroProcesso` + `tribunal` já verificados pelo operador como
pertencentes ao candidato-alvo (ver "Entity resolution" acima — não há como
descobrir processos de um candidato via esta API, só confirmar um número já
conhecido). Todo o resto — client, validação de tribunal/número, mapeamento
conservador de movimentação, hash estável, construção de resumo/título sem
CPF, upsert com dedup — já está implementado e passa em `npm run
typecheck`. O `--dry-run` sem chave foi testado contra a API real em
2026-08-10 e confirma `401` (`security_exception` do Elasticsearch,
`WWW-Authenticate: ApiKey`), validando que a integração aponta para o lugar
certo.
