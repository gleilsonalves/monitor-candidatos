# Coletor do Diário Oficial da União (DOU)

Coleta atos de nomeação/exoneração publicados no DOU, via busca pública por
nome em `in.gov.br`. Ver [`../../../README.md`](../../../README.md) para o
framework de coletores em geral — este arquivo documenta só as decisões
específicas desta fonte.

**Leia a seção "Entity resolution" antes de usar os dados deste coletor para
qualquer métrica.** Esta é, das fontes oficiais do projeto, a que tem a
resolução de identidade mais fraca — não por falta de cuidado na
implementação, mas porque a fonte em si não expõe nenhum identificador único
de pessoa.

## Endpoint real (descoberto e confirmado nesta implementação)

Não existe uma API REST/JSON documentada publicamente para busca no DOU. O
`projeto-monitor-candidatos.md` (seção 2.1) menciona "`in.gov.br` (JSON por
edição)" — isso existe (arquivos de edição completa), mas não permite buscar
por nome dentro de um intervalo de datas, que é o que este coletor precisa.
O que foi encontrado e usado é a busca do **portal público** de pesquisa do
DOU (o mesmo que um humano usa em `https://www.in.gov.br/leiturajornal`),
que devolve **HTML, não JSON** — mas com os resultados embutidos como JSON
dentro de uma tag `<script>` no próprio HTML.

Descoberto inspecionando a página `https://www.in.gov.br/consulta/-/buscar/dou`
com `curl` (não Chrome DevTools desta vez — o `grep` no HTML bruto já expôs
o portlet responsável, `br_com_seatecnologia_in_buscadou_BuscaDouPortlet`, e
o objeto JS `request` que ele usa para montar a query) e confirmado com
requisições reais antes de escrever qualquer parser.

```
GET https://www.in.gov.br/consulta/-/buscar/dou
```

### Parâmetros de query confirmados

| Parâmetro | Valor | Observação |
|---|---|---|
| `q` | termo de busca, **entre aspas** para forçar busca "por frase" (ex: `q="Camilo Santana"`) | Sem aspas, o motor de busca trata os tokens como OR livre e o ruído explode — confirmado na prática (ver "Validação" abaixo). Com aspas, o resultado fica bem mais restrito, mas **não é uma garantia de adjacência exata** (ver limitação abaixo). |
| `s` | seção(ões): `todos`, `do1`, `do2`, `do3`, `do1e`/`do2e`/`do3e` (edições extra) | Pode repetir o parâmetro para múltiplas seções. Este coletor usa `todos` por padrão — nomeações de Ministros saem na Seção 1 (DO1), nomeações de servidores em geral saem na Seção 2 (DO2, "Atos de Pessoal"). |
| `exactDate` | `all` \| `dia` \| `semana` \| `mes` \| `ano` \| `personalizado` | Este coletor usa `personalizado` quando `--dataInicio`/`--dataFim` são passados, e `all` (sem filtro de data) quando nenhum dos dois é passado. |
| `publishFrom` / `publishTo` | `DD-MM-AAAA` (com hífen, não barra) | Só usado com `exactDate=personalizado`. Confirmado por teste real — o formulário do site converte `DD/MM/AAAA` do datepicker para `DD-MM-AAAA` antes de montar a URL. |
| `sortType` | `0` | Ordenação (relevância). Não explorado a fundo — `0` é o default do formulário. |
| `currentPage`, `newPage`, `score`, `id`, `displayDate` | cursor de paginação | **Não é paginação por offset.** A página seguinte exige o `score`, `classPK` (vira `id`) e `displayDateSortable` (vira `displayDate`) do ÚLTIMO item da página anterior — confirmado replicando manualmente o fluxo do JS do site com `curl`. |

### Formato da resposta

`Content-Type: text/html`. Os resultados vêm embutidos assim, dentro do HTML
retornado:

```html
<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">
{"jsonArray":[{"pubName":"DO2","urlTitle":"portarias-de-28-de-julho-de-2026-722168375","title":"PORTARIAS DE 28 DE JULHO DE 2026","pubDate":"30/07/2026","editionNumber":"142","content":"...<span class='highlight'>Camilo</span>...","artType":"Portaria","classPK":"722168377","hierarchyStr":"Poder Legislativo/Senado Federal/Diretoria-Geral","hierarchyList":["Poder Legislativo","Senado Federal","Diretoria-Geral"], "...": "..."}]}
</script>
```

`client.ts` (`DouApiClient`) faz o parse desse HTML com regex — extrai o
bloco JSON (`jsonArray`) e o `totalPages` (que fica solto no segundo
`<script>` da página, no objeto `request`, não dentro do JSON). Se o portal
mudar de layout, o parser loga um erro explícito (`"não foi possível
encontrar o bloco JSON de resultados"`) em vez de falhar silenciosamente ou
quebrar com uma exceção genérica.

`fonte_url` do evento é montada a partir de `urlTitle`:
`https://www.in.gov.br/web/dou/-/{urlTitle}` — confirmado retornando
`HTTP 200` com `curl` contra um resultado real.

### Por que não a API "JSON por edição" citada no documento de arquitetura

O `in.gov.br` também expõe os PDFs/JSONs de cada edição completa do DOU (útil
para quem quer baixar a edição inteira e processar localmente), mas essa via
não tem busca por nome/termo — seria necessário baixar e indexar todo o
conteúdo publicado desde sempre para replicar o que a busca pública já faz
de graça. A busca do portal (`/consulta/-/buscar/dou`) foi escolhida por
resolver exatamente o problema deste coletor (achar as poucas menções de um
candidato específico) sem reimplementar um motor de busca.

## Entity resolution — a limitação central desta fonte

**Esta é a fonte mais fraca de entity resolution do projeto.** As outras
fontes oficiais resolvem por identificador: Câmara por `id_camara` (seção 5,
passo 1, confiança 1.0), TSE por nome+UF+partido (passo 2, confiança ~0.9,
com desambiguação por contexto eleitoral). O DOU **não expõe nenhum
identificador de pessoa nos atos publicados** — nem CPF, nem um "ID de
servidor" pesquisável, nem nada equivalente a um `id_camara`. A única forma
de buscar é texto livre por nome, e uma pessoa é citada num ato de duas
formas bem diferentes que a busca **não distingue**:

1. **A pessoa é o sujeito do ato** (foi nomeada/exonerada) — o caso que
   queremos capturar.
2. **A pessoa é só mencionada** — most comumente porque o nome dela batiza
   um órgão/gabinete (ex: "Gabinete do Senador Fulano de Tal"), e o ato real
   é sobre outra pessoa (um assessor sendo nomeado/exonerado **daquele**
   gabinete).

### Caso real encontrado durante a validação deste coletor

Buscando `"Camilo Santana"` (Ministro da Educação, nome comum o bastante
para servir de teste realista) em `s=do2` (Seção 2, Atos de Pessoal), **12
dos 20 primeiros resultados** eram portarias do Senado Federal nomeando ou
exonerando **assessores parlamentares** — não Camilo Santana. Trecho real
retornado pela busca (ato `portarias-de-28-de-julho-de-2026-722168375`):

> "...do órgão GABSEN/GSCAMILO - Gabinete do Senador Camilo ... Santana, e
> nomeá-lo para o cargo, em comissão, de ASSISTENTE PARLAMENTAR PLENO..."

Isso é a Portaria de nomeação de um **funcionário do gabinete do senador**
Camilo Santana (à época em que ele era Senador, antes de virar Ministro) —
não um ato sobre o próprio Camilo Santana. `classificarAto()` (o filtro de
"isso parece um ato de nomeação/exoneração?") corretamente identifica que o
texto usa linguagem de nomeação — porque **é** um ato de nomeação, só que da
pessoa errada. Nenhuma checagem de texto livre resolve isso com segurança:
o nome do candidato aparece no ato genuinamente, só que como parte do nome
do órgão emissor, não como o nomeado.

**Isso não é um bug para corrigir — é uma característica estrutural da
fonte**, documentada aqui exatamente para que quem consumir estes eventos
saiba que precisa ler o `resumo` (e idealmente o ato completo em
`fonte_url`) antes de tratar um evento do DOU como "fato estabelecido" sobre
o candidato, do jeito que trataria um `id_camara` batendo.

### Segundo caso real, ainda mais grave: a busca "por frase" nem garante o nome certo

Rodando a mesma busca (`"Camilo Santana"`, sem filtro de seção/data desta
vez — 254 artigos brutos, 20 classificados como nomeação/exoneração) apareceu
este resultado:

> "Nº 140 - Nomear **CAMILA SANTANA ARAÚJO MUTTI**, nos termos dos artigos 9º,
> item I, e 10 da Lei nº 8.112..." — Tribunal Regional do Trabalho da 15ª
> Região, DOU de 14/12/2017.

Note: **"Camila" (feminino), não "Camilo"**. A busca por frase entre aspas
(`q="Camilo Santana"`) **não garante correspondência exata do nome** — o
motor de busca do portal claramente faz *stemming*/normalização antes de
comparar (provável: reduz "Camilo"/"Camila" à mesma raiz "camil"), então uma
busca "exata" por um nome masculino específico traz de volta uma pessoa
diferente, de outro gênero, num tribunal diferente, num ano completamente
diferente. Isso é estritamente mais grave que o caso do "Gabinete do Senador"
acima: ali pelo menos o nome batia exatamente e a pessoa citada era
realmente o candidato buscado (só que como nome de órgão, não como sujeito
do ato); aqui **nem o nome bate**.

Conclusão prática: nenhuma configuração de query neste endpoint (aspas,
seção, data) é suficiente por si só para garantir que um resultado é sobre a
pessoa certa. O filtro de linguagem de nomeação/exoneração
(`classificarAto()`) reduz o volume de ruído não relacionado a atos de
pessoal, mas não resolve nenhum dos dois problemas acima — nem "nome certo,
pessoa errada" (citada como nome de órgão) nem "nome errado" (stemming do
motor de busca). Ambos exigem leitura humana do `resumo`/`fonte_url` antes
de qualquer uso em métrica.

### O que este coletor faz para mitigar (sem fingir que resolve)

- **Busca por frase** (`q="Nome Completo"`), não por termos soltos — reduz
  bastante o volume de ruído (nomes comuns aparecendo em contextos
  completamente não relacionados), mas como mostrado no exemplo acima, não
  garante que a pessoa citada seja o sujeito do ato.
- **Filtro de linguagem de nomeação/exoneração** (`classificarAto()` em
  `collector.ts`): só vira evento o ato cujo título/trecho usa verbos de
  nomeação (`nomear`, `nomeação`, `designar`, incluindo formas com pronome
  clítico hifenizado como "nomeá-lo") ou exoneração (`exonerar`,
  `exoneração`). Sem LLM — é checagem de padrão sobre texto oficial
  estruturado, mesma justificativa de `truncate()` em `lib/text.ts`
  (classificação por LLM fica pra Fase 2, seção 6 do documento). Isso evita
  que qualquer menção do nome num edital, extrato de contrato, ata etc. vire
  um evento `tipo='nomeacao'` — mas **não** distingue "nomeado" de
  "mencionado num ato de nomeação de outra pessoa".
- **Log de aviso explícito em `prepare()`** toda vez que o coletor roda para
  um candidato, lembrando que a confiança de entity resolution aqui é
  estruturalmente menor que Câmara/TSE e que revisão manual é recomendada.
- **O termo de busca é sempre `candidato.nome_civil`** (nome completo, não
  `nome_urna`) — reduz colisão com homônimos que usam só o primeiro nome ou
  apelido, mas não elimina homônimos de nome completo igual (existem, embora
  raros).

### O que este coletor **não** tenta fazer

Não há tentativa de desambiguar por cargo/órgão contra dado conhecido do
candidato (ex: comparar `hierarchyStr` do ato com alguma "ocupação atual"),
porque a tabela `candidato` não tem esse campo — só `cargo_pretendido`
(o cargo ELEITORAL disputado, ex: "Presidente", não um cargo público já
ocupado) e `partido_atual`. Cargo pretendido não ajuda a confirmar um ato de
nomeação/exoneração passado (um candidato a Presidente pode ter sido
Ministro, Prefeito, Deputado, ou nenhum cargo público antes — o
`cargo_pretendido` não prediz isso). Implementar essa corroboração exigiria
um campo novo (ex: "cargos públicos já ocupados") fora do escopo deste
coletor (schema é `db/migrations/0001_core_schema.sql`, fora da pasta em que
este trabalho foi escopado).

## Decisão de `fonte_confianca`

Este coletor grava **`fonte_confianca = 1`** (oficial) mesmo com entity
resolution por nome, pela mesma lógica já aplicada por
`collectors/transparencia/README.md` para uma limitação parecida: **a escala
de `fonte_confianca` mede a fonte** (é uma publicação oficial do governo
federal, no Diário Oficial — não há fonte mais oficial que essa para um ato
administrativo), **não a certeza do match de entidade**. Não existe hoje no
schema (`evento.fonte_confianca smallint 1|2|3`) uma dimensão separada para
"confiança do match de entidade" vs. "confiança da fonte em si" — são coisas
diferentes que o valor `1` conflaciona.

Dado isso, a decisão foi: manter `fonte_confianca = 1` (é honestamente o que
a coluna representa — a fonte É oficial), e colocar todo o peso da
advertência em texto explícito: log estruturado em `prepare()` (nível
`warn`, não `info` — aparece destacado em qualquer pipeline de observabilidade
que filtre por severidade), o comentário extenso na classe `collector.ts`, e
este README. Rebaixar `fonte_confianca` para 2 (nível "imprensa" no schema)
pareceu pior: DOU não é imprensa, é a fonte primária mais oficial que existe
para este tipo de ato — o problema não é a fonte, é a ausência de um
identificador de pessoa nela.

**Ressalva importante sobre a policy de leitura pública:** a RLS de `evento`
(`db/migrations/0001_core_schema.sql`) só exige `revisado_humano = true`
para eventos `categoria = 'controversia'`. Os eventos deste coletor são
`categoria = 'neutro'` (nomeação/exoneração não é boa nem ruim por si só —
seção 1 do documento de arquitetura), então **ficam públicos imediatamente**,
sem revisão humana obrigatória, mesmo com a fragilidade de entity resolution
documentada acima. Isso é uma tensão real que este coletor não resolve
sozinho (mudar isso exigiria alterar a policy de RLS ou o enum de
`categoria`, fora do escopo desta pasta) — fica registrado aqui para quem for
decidir se `revisado_humano` deveria ser exigido também para `tipo='nomeacao'`
vindo especificamente da fonte DOU, independente de `categoria`.

## Modelagem em `evento`

| Campo | Valor |
|---|---|
| `tipo` | `'nomeacao'` — o enum do banco **não tem** um valor `'exoneracao'`; exoneração também usa `'nomeacao'`, diferenciado só pelo texto de `titulo`/`resumo` (mesma decisão pragmática documentada em `collectors/tse/README.md` para "registro de candidatura") |
| `categoria` | `'neutro'` — nomeação/exoneração não é por si só uma realização ou controvérsia |
| `estagio_juridico` | `null` — só se aplica a `tipo='processo'` (CHECK constraint no banco) |
| `titulo` | `"Nomeação — {órgão}"` ou `"Exoneração — {órgão}"`, onde `{órgão}` é o último nível de `hierarchyList` (o órgão emissor mais específico, ex: "Diretoria-Geral") |
| `resumo` | texto do trecho retornado pela busca (com HTML removido), prefixado com tipo de ato, data, jornal/edição/página e órgão — **é um recorte da busca, não o ato completo** (isso fica explícito no próprio texto do resumo) |
| `data_evento` | `pubDate` do artigo (data de publicação da edição) |
| `fonte_nome` | `"Diário Oficial da União"` |
| `fonte_url` | `https://www.in.gov.br/web/dou/-/{urlTitle}` |
| `fonte_confianca` | `1` (ver seção acima) |
| `hash_conteudo` | `sha256("nomeacao\|{candidato_id}\|dou\|{classPK}")` — inclui `candidato_id` porque um mesmo artigo pode gerar eventos para candidatos diferentes se mencionar mais de um nome buscado |

## Validação realizada (dados reais, não simulados)

Testado em 10/08/2026 com `curl` direto contra `in.gov.br` antes de escrever
qualquer código, e depois com o coletor real via `--dry-run`:

- **Busca sem aspas** (`q=Camilo Santana`, sem forçar frase): `totalPages`
  na casa de milhares — o motor trata como OR livre, virou ruído
  praticamente aleatório (ex: bateu em "Prefeitura Municipal de Santana do
  Araguaia" e "Santa Maria do Salto", que não têm relação nenhuma com
  "Camilo" nem com "Santana" como nome de pessoa). Confirma que a busca por
  frase (com aspas) é obrigatória, não opcional, para esta fonte.
- **Busca com aspas**, seção `do2`, sem filtro de data: 20 resultados (2
  páginas), todos DO2. Confirma que o parâmetro `s` filtra corretamente por
  seção.
- **Busca com aspas + intervalo de datas customizado** (`exactDate=personalizado`,
  `publishFrom=01-01-2026`, `publishTo=10-08-2026`): resultados restritos ao
  período, `totalPages` menor. Confirma o formato de data (`DD-MM-AAAA`).
- **Paginação por cursor**: replicado manualmente o fluxo da segunda página
  (`newPage=2` + `score`/`id`/`displayDate` do último item da página 1) e
  confirmado que retorna os próximos 20 resultados corretamente, não
  repetidos.
- **`--dry-run` do coletor** (`npm run collect:dou -- --dry-run
  --dataInicio=2025-01-01 --dataFim=2026-08-10`, nome default "Camilo
  Santana"): 95 artigos brutos encontrados, 12 classificados como
  nomeação/exoneração pelo filtro de linguagem — **todos os 12 eram sobre
  assessores do gabinete dele, não sobre ele** (ver seção "Entity resolution"
  acima). Prova, com dado real, tanto que o pipeline funciona ponta a ponta
  quanto o risco de falso positivo que este README existe pra documentar.

### Honestidade sobre o resultado da validação

O objetivo da validação não era "achar uma nomeação real do candidato de
teste" — era confirmar que (a) o endpoint funciona, (b) o parsing extrai os
campos corretos de um resultado real, e (c) o filtro de classificação
reconhece linguagem de nomeação/exoneração de verdade. Os três foram
confirmados. O que a validação **também** deixou claro, sem precisar
simular nada, é que a busca por nome nesta fonte tem uma taxa de falso
positivo real e não-hipotética para nomes que também nomeiam órgãos/gabinetes
— **é genuinamente frágil**, não só "teoricamente menos confiável que ID".
Recomendação para quem for usar isto em produção: tratar todo evento vindo
de `dou_atos_pessoal` como candidato a revisão humana antes de aparecer em
qualquer métrica agregada, independente do que a coluna `fonte_confianca`
diz.

## Como testar

```bash
# validar fetch/normalize contra a busca real do DOU, sem gravar no banco e
# sem SUPABASE_SERVICE_ROLE_KEY — usa "Camilo Santana" como amostra default:
npm run collect:dou -- --dry-run

# outro nome, e/ou intervalo de datas customizado:
npm run collect:dou -- --dry-run --nome="Fulano de Tal" --dataInicio=2024-01-01 --dataFim=2026-08-10

# coleta de verdade (grava no banco) — precisa de SUPABASE_SERVICE_ROLE_KEY e
# que o candidato já exista em `candidato` com nome_civil preenchido:
npm run collect:dou -- --candidatoId=<uuid>
npm run collect:dou -- --candidatoId=<uuid> --dataInicio=2023-01-01 --dataFim=2026-08-10
```

`--nome` só existe no modo `--dry-run` (inspeção sem banco). Em execução
real, o termo de busca vem sempre de `candidato.nome_civil`, resolvido em
`prepare()` a partir de `--candidatoId`.

### Variáveis de ambiente específicas (opcionais)

- `DOU_API_BASE` — default `https://www.in.gov.br/consulta/-/buscar/dou`.
  (Não precisa ser adicionada a `.env.example` — o default já cobre o uso
  normal.)
