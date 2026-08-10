# Coletor: Portal da Transparência (CGU) — CEIS/CNEP

Segue o framework descrito em [`../../../README.md`](../../../README.md)
("Como adicionar um novo coletor"). Este documento cobre o que é específico
desta fonte: a API real, como conseguir a chave, a limitação de entity
resolution encontrada e como validar sem uma chave.

## O que este coletor coleta

Sanções administrativas contra **pessoa física** registradas em dois
cadastros da CGU, ambos expostos pela mesma API `api-de-dados`:

- **CEIS** — Cadastro de Empresas Inidôneas e Suspensas
  (`GET /api-de-dados/ceis`)
- **CNEP** — Cadastro Nacional de Empresas Punidas, Lei Anticorrupção
  12.846/2013 (`GET /api-de-dados/cnep`)

Cada registro vira um `evento` com `tipo='sancao'`, `categoria='controversia'`,
`estagio_juridico=null` (sanção administrativa não é processo judicial no
sentido do enum — seção 1 do documento de arquitetura), `fonte_confianca=1`.

## A API é sobre "empresas", mas atinge pessoa física — confirmado

Apesar do nome dos dois cadastros mencionar "empresas", **a própria API
confirma que pessoas físicas são sancionadas diretamente**, não só como
sócios/responsáveis nomeados dentro do registro de uma empresa. Isso foi
verificado no schema OpenAPI real, publicado em
<https://api.portaldatransparencia.gov.br/v3/api-docs> (consultado em
2026-08-10):

- O parâmetro de busca `codigoSancionado` de ambos os endpoints é
  documentado literalmente como **"CNPJ ou CPF Sancionado"** — busca por CPF
  é suportada nativamente, não é um workaround.
- Cada registro (`CeisDTO`/`CnepDTO`) tem um campo `pessoa` (`PessoaDTO`) com
  `cpfFormatado`, `cnpjFormatado`, `nome` e `tipo` — visto em dados reais
  indexados publicamente como `"FISICA"` ou `"JURIDICA"`.
- Exemplos reais de URLs públicas de detalhe confirmam o padrão
  `/pessoa-fisica/{id}` ao lado de `/pessoa-juridica/{id}`, ex.:
  `https://portaldatransparencia.gov.br/sancoes/ceis/157222265/pessoa-fisica/8418484`.

Ou seja: **não é necessário** vasculhar registros de empresas atrás de sócios
nomeados — a busca por CPF (`codigoSancionado=<cpf>`) já retorna diretamente
as sanções aplicadas à pessoa física, quando existirem.

## Endpoint exato e validação sem chave

A API exige a header `chave-api-dados` em toda requisição. Sem ela, uma
chamada real (feita em 2026-08-10, sem qualquer chave) confirma que a rota é
a correta:

```
$ curl -i "https://api.portaldatransparencia.gov.br/api-de-dados/ceis?pagina=1"
HTTP/1.1 401
Content-Type: application/json;charset=ISO-8859-1
...
{"Erro na API":"Chave de API não informada! Para obter a chave acesse http://www.portaldatransparencia.gov.br/api-de-dados/cadastrar-email"}
```

`401`, não `404` — a rota `/api-de-dados/ceis` (e o mesmo teste para
`/api-de-dados/cnep`) existe e está correta; falta só a chave. O modo
`--dry-run` deste coletor reproduz essa mesma checagem automaticamente (ver
"Rodando" abaixo).

## Como conseguir a própria API key

1. Acesse <http://www.portaldatransparencia.gov.br/api-de-dados/cadastrar-email>
   e cadastre um e-mail (gratuito, sem aprovação manual segundo a
   documentação oficial).
2. A chave chega por e-mail.
3. Cole em `PORTAL_TRANSPARENCIA_API_KEY` no `.env` deste pacote
   (`packages/workers/.env` — copie de `.env.example` se ainda não existir).
   A variável já está prevista no `.env.example` da raiz do monorepo; foi
   replicada aqui também.

## Entity resolution — a limitação real encontrada

Este é o ponto mais importante deste coletor. A API só busca por
**CPF/CNPJ** (`codigoSancionado`) ou por **nome** (`nomeSancionado`) — não
existe um ID interno do candidato (como `id_camara` na Câmara) que a API do
Portal da Transparência reconheça.

A tabela `candidato` (seed atual de 8 candidatos, projeto
`mjojuycrkxidpkzyzuuz`) tem `nome_civil`, `nome_urna`, `uf`,
`partido_atual`, `id_camara` — **nenhum tem `id_tse` nem `cpf_hash`
preenchido** (confirmado por consulta direta à tabela). E mesmo que
`cpf_hash` estivesse preenchido, ele é **um hash** (por LGPD — seção 9 do
documento de arquitetura: "CPF só em hash"), não reversível ao CPF em claro
que a API exige na query string.

Ou seja: **não há, hoje, nenhum caminho determinístico dentro do banco** que
leve de um `candidato_id` a um CPF utilizável nesta API. As duas opções que
existiriam não servem:

- **Buscar por nome (`nomeSancionado`)** — a API suporta, mas usar isso para
  criar um evento `categoria='controversia'` é exatamente o cenário proibido
  pela seção 5 do documento ("nunca deixar match fuzzy alimentar métrica
  direto... é o pior bug possível deste sistema"). Homônimos são comuns em
  nomes brasileiros. Este coletor **nunca** implementa essa busca.
- **Usar `cpf_hash` do banco** — estruturalmente impossível: é um hash
  unidirecional, não dá para reconstruir o CPF a partir dele para consultar
  a API.

### Solução adotada: CPF fornecido pelo operador, nunca persistido

A resolução de entidade aqui acontece em duas partes independentes, **ambas
determinísticas**:

1. `candidato_id` é resolvido por `id_camara` (`prepare()`), exatamente como
   no coletor da Câmara — confiança 1.0, mesmo padrão de "aborta sem gravar
   nada se não encontrar" (seção 5, passo 1).
2. O **CPF em claro usado na consulta à API** vem do parâmetro `--cpf` da
   CLI, fornecido pelo operador a partir de uma fonte externa confiável (ex:
   o próprio registro de candidatura no TSE, que exige CPF na filiação, mas
   que este banco propositalmente não armazena em claro). Esse CPF:
   - **nunca** é lido do banco;
   - **nunca** é gravado no banco (nem em `candidato`, nem em `raw_payload`
     — o que vai para `raw_payload` é a *resposta* da API, que já vem com o
     CPF mascarado em `pessoa.cpfFormatado`, não o CPF de entrada);
   - **nunca** tem um valor default no `.env` — só existe como argumento de
     linha de comando, de propósito, para não deixar um CPF em claro sentado
     num arquivo que poderia ser commitado por engano.

Isso é honesto sobre o que a API oferece: ela é 100% funcional para pessoa
física por CPF, mas o **gap de entity resolution não está na API** — está no
fato de que este banco de dados, corretamente, não guarda CPF em claro. Até
que exista um processo operacional para o time confirmar e informar o CPF de
cada candidato de forma pontual e auditável (fora deste coletor), a coleta
real para um candidato específico depende de `--cpf` ser passado à mão a
cada execução.

## Toda sanção nasce não revisada — proposital, não bug

Todo evento `categoria='controversia'` nasce com `revisado_humano=false` —
esse é o `DEFAULT` da coluna no banco (`db/migrations/0001_core_schema.sql`),
o coletor não precisa (e não deve) setar isso explicitamente. O motivo:

```sql
create policy "public read evento" on evento for select using (
  revisado_humano = true or categoria <> 'controversia'
);
```

Uma sanção **nunca aparece na leitura pública** até alguém revisá-la
manualmente. Isso é proposital (seção 9 do documento: "revisão humana
obrigatória para todo evento de categoria `controversia`"), não uma falha de
integração — é a mitigação principal contra o maior risco deste projeto
(difamação).

## Rodando

```bash
npm install

# 1) Validar que a rota está correta, SEM chave e SEM gravar no banco:
#    faz uma chamada real à API sem PORTAL_TRANSPARENCIA_API_KEY e confirma
#    que a resposta é 401/403 (não 404) — prova que /api-de-dados/ceis e
#    /api-de-dados/cnep estão certos.
npm run collect:transparencia -- --idCamara=204554 --dry-run

# 2) Com uma chave real, dry-run mostra fetch/normalize de verdade (ainda
#    sem gravar, ainda sem precisar de SUPABASE_SERVICE_ROLE_KEY):
cp .env.example .env   # preencha PORTAL_TRANSPARENCIA_API_KEY
npm run collect:transparencia -- --idCamara=204554 --cpf=12345678900 --dry-run

# 3) Coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY
#    E PORTAL_TRANSPARENCIA_API_KEY, e --cpf é obrigatório (nunca inferido):
npm run collect:transparencia -- --idCamara=204554 --cpf=12345678900

# alternativa: definir TRANSPARENCIA_ID_CAMARA no .env em vez de --idCamara
# (--cpf nunca tem equivalente em .env, de propósito — ver seção acima)
```

Se `id_camara` não existir na tabela `candidato`, o coletor loga um aviso e
encerra sem gravar nada, igual ao coletor da Câmara.

## Variáveis de ambiente (`.env`, neste pacote)

- `PORTAL_TRANSPARENCIA_API_KEY` — obrigatória para coleta real (não para
  `--dry-run` sem chave, que só valida a rota). Ver "Como conseguir a
  própria API key" acima.
- `PORTAL_TRANSPARENCIA_API_BASE` — opcional, já vem com o default
  `https://api.portaldatransparencia.gov.br/api-de-dados`.
- `TRANSPARENCIA_ID_CAMARA` — opcional, usado quando `--idCamara` não é
  passado via linha de comando.
- **Não existe** variável de ambiente para o CPF — só `--cpf` na linha de
  comando (ver "Solução adotada" acima).

## Estrutura

```
transparencia/
  types.ts     tipos da API (CeisRegistro, CnepRegistro, PessoaDTO, ...) — confirmados
               contra o OpenAPI real em api.portaldatransparencia.gov.br/v3/api-docs
  client.ts    PortalTransparenciaApiClient — busca por CPF em CEIS e CNEP,
               paginação (para quando a página vier vazia), retry, rate limit
  collector.ts TransparenciaSancoesCollector extends Collector<RegistroSancaoBruto>
```

## O que falta para funcionar 100%

Só a `PORTAL_TRANSPARENCIA_API_KEY` de verdade (gratuita, ver acima) e, para
cada execução real, o CPF do candidato-alvo (fornecido pelo operador, fora
deste banco). Todo o resto — client, paginação, normalização, hash estável,
proteção contra pessoa jurídica, construção de `fonte_url`, upsert com dedup
— já está implementado e passa em `npm run typecheck`. O `--dry-run` sem
chave foi testado contra a API real em 2026-08-10 e confirma `401` nas duas
rotas (`ceis` e `cnep`), validando que a integração aponta para o lugar
certo.
