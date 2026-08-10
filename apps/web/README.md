# Monitor de Candidatos — frontend (`apps/web`)

React + Vite + TypeScript + Tailwind CSS v4. Consome a API em `packages/api`
(porta padrão `3333`) e calcula o score final **inteiramente no navegador**.

## Rodando localmente

```bash
cd apps/web
npm install
cp .env.example .env   # ajuste VITE_API_URL se a API não estiver em localhost:3333
npm run dev             # abre em http://localhost:5173
```

```bash
npm run build            # type-check (tsc -b) + build de produção em dist/
npm run preview          # serve o build de produção localmente
```

A UI **não quebra se a API estiver fora do ar ou com o banco vazio**: toda
tela tem um estado de carregamento (skeleton), um estado de erro/offline e um
estado vazio desenhados de propósito. Isso foi validado tanto com
`npm run build` (checagem de tipos) quanto navegando na aplicação com a API
real de `packages/api` no ar e o banco ainda sem candidatos.

## Direção visual

O pedido era "muitos efeitos visuais e modernos" **sem** perder a seriedade
editorial do produto — o princípio central é que o app nunca emite veredito.
A resposta a essa tensão foi um sistema de design **"dossiê institucional"**:

- **Paleta**: fundo grafite-tinta quase preto (`#0B0E14`), superfícies em
  camadas de cinza-azulado frio, e dois acentos — um azul-selo institucional
  (`#3E7CB1`, usado em links/fontes) e um âmbar-carimbo (`#C88A2E`, usado em
  interação/destaque). Papel creme (`#F2EDE1`) aparece só como textura sutil
  de fundo (watermark pontilhado), evocando papel timbrado oficial sem virar
  um app "bege AI genérico".
- **Tipografia**: `Fraunces` (serifada, com caráter editorial) para títulos,
  `Inter` para UI/corpo, `IBM Plex Mono` para todo dado numérico, datas,
  handles e rótulos de estágio jurídico — o mono reforça a ideia de "isto é
  um registro auditável", não uma opinião.
- **Motivo/assinatura visual**: o **carimbo de estágio jurídico**
  (`EstagioStamp`) — um selo rotacionado com borda dupla e tipografia mono
  maiúscula, uma cor por estágio, nunca um badge binário "culpado/inocente".
  É o elemento mais repetido do produto porque é literalmente a proteção
  jurídica central do projeto (seção 1 e 9 do documento de arquitetura) —
  fazer dele a peça visual mais marcante é intencional, não decoração.
- **Segundo motivo**: o **painel de pesos como console de mixagem** — cada
  dimensão é um fader vertical (não um slider horizontal genérico), com
  leitura numérica em mono ao vivo e um medidor semicircular (`ScoreGauge`)
  animado com spring (`framer-motion`) que se move suavemente a cada arraste.
- **Imagem**: a hero da home usa uma foto do Congresso Nacional (Wikimedia
  Commons, domínio público/CC, via `Special:FilePath` — sem hotlink de fonte
  não-livre) como textura de fundo em baixa opacidade atrás do headline,
  nunca como protagonista. Fotos de candidatos usam **placeholder neutro com
  iniciais + silhueta** (`AvatarPlaceholder`) até o pipeline popular
  `foto_url` — nunca uma foto de terceiro sem licença.
- **Motion**: entradas com `framer-motion` (fade+slide em cards e timeline,
  spring no gauge, drawer lateral com spring), tudo respeitando
  `prefers-reduced-motion`.

## Regra não-negociável: estágio jurídico

`src/data/estagioJuridico.ts` centraliza os 8 valores de `estagio_juridico`
com rótulo, explicação de uma frase e cor própria — nunca colapsados. O
componente `EstagioStamp` (`src/components/ui/EstagioStamp.tsx`) é o único
lugar que renderiza esse selo, sempre num evento `tipo === 'processo'`, e
`EstagioLegenda` explica a régua completa (denúncia → trânsito em julgado,
com arquivado/absolvido como desfechos à parte, não "menos graves").

## Auditabilidade: todo número é clicável

- Todo evento na timeline tem `SourceLink` com `fonte_url` clicável.
- Cada dimensão do painel de pesos (e do widget de score no perfil do
  candidato) é um número clicável (`ScoreBreakdownList`) que abre um
  `Drawer` (`DimensionAuditDrawer`) com a lista de eventos que sustentam
  aquele valor, cada um com seu link de fonte.

**Decisão de design documentada**: a API ainda não expõe um filtro
`/candidatos/:id/eventos?dimensao=`, então o drawer filtra a timeline do
candidato pelo(s) `tipo` de evento mais associado a cada dimensão (mapa em
`src/data/dimensoes.ts`, ex.: `integridade` → `processo`/`sancao`,
`producao_legislativa` → `proposicao`). Quando não há evento desse tipo, o
drawer mostra a fonte declarada da dimensão em vez de fingir uma lista vazia
como se fosse zero eventos relevantes. Isso é uma ponte até o backend expor
a relação de forma explícita — o objetivo é nunca esconder a aproximação do
usuário.

## Cálculo do score (roda no cliente)

```
score_final = Σ (metrica_normalizada[i] × peso_usuario[i]) / Σ peso_usuario[i]
```

Implementado em `src/lib/score.ts`, puro e sem dependência de rede. Escala de
peso escolhida: **0–100** (mesma escala das métricas normalizadas) — mais
legível numa UI de faders do que 0–1, e mapeia 1:1 pro atributo `value` de
`<input type="range">`. Dimensões sem peso (`peso = 0`) ou sem métrica
carregada não entram no denominador, então o score nunca fica artificialmente
puxado para baixo por dado ausente.

Os pesos do usuário persistem em `localStorage`
(`monitor-candidatos:pesos:v1`, ver `src/context/WeightsContext.tsx`) — nunca
em servidor. Os três presets ("foco em integridade", "foco em produção
legislativa", "foco em área social") só pré-preenchem os faders; continuam
100% editáveis depois de aplicados.

## Estrutura

```
src/
  lib/            cliente de API tipado, formatação, cálculo de score
  data/           metadados de apresentação (estágio jurídico, tipos de evento, dimensões, presets)
  context/        WeightsContext (pesos do usuário, persistidos em localStorage)
  hooks/          useApi — wrapper de fetch que nunca lança, sempre resolve em {data,loading,error,offline}
  components/
    ui/           primitivas (EstagioStamp, SourceLink, AvatarPlaceholder, Drawer, EmptyState, Skeleton…)
    candidatos/   grid/filtros da home
    perfil/       header, timeline e card de evento do perfil do candidato
    pesos/        faders, gauge, breakdown e drawer de auditoria do painel de pesos
  pages/          Home, CandidatoPerfil, PainelPesos, Metodologia, NotFound
```

## Trade-offs conhecidos

- Sem React Query/SWR — o volume de chamadas é pequeno o bastante para um
  hook `useApi` simples resolver sem cache/revalidação sofisticados. Se o
  app crescer (comparador multi-candidato, polling), vale reconsiderar.
- `Recharts`/`visx` (sugeridos na seção 7 do documento) não entraram — o
  único gráfico do produto hoje é o gauge de score, e um `<svg>` custom com
  `framer-motion` deu mais controle sobre a animação spring do que uma lib de
  charting genérica traria. Se o comparador (Fase 4) trouxer séries
  temporais, aí sim vale importar uma lib de gráficos.
- O fader vertical usa `writing-mode: vertical-lr` + `direction: rtl` em vez
  do não-padrão `-webkit-appearance: slider-vertical` — funciona com mouse,
  toque e teclado (setas ainda ajustam o valor) nos engines atuais, mas é a
  parte mais "artesanal" do CSS deste projeto; vale um teste manual extra em
  Safari se o navegador-alvo do time incluir Safari desktop antigo.
