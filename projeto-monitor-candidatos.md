# Projeto: Monitor de Candidatos

**Plataforma web de agregação e metrificação de dados públicos sobre candidatos à Presidência da República**

Versão 1.0 — documento de arquitetura e escopo

---

## 1. Princípio de design

O app **não emite veredito**. Ele agrega fato verificável com fonte linkada e deixa o **peso de cada dimensão configurável pelo usuário**. O score é calculado no cliente, a partir dos pesos que o próprio usuário define.

Isso resolve três problemas de uma vez:

- Elimina a acusação de viés editorial (o viés é do usuário, explicitamente)
- Reduz drasticamente o risco jurídico (você publica dado oficial, não julgamento)
- Torna o produto interessante: duas pessoas com valores diferentes obtêm rankings diferentes da mesma base factual

**Regra inegociável de modelagem:** todo evento negativo carrega um campo `estagio_juridico` com valores estritamente separados — `denuncia`, `investigacao_aberta`, `acao_recebida`, `condenacao_1a_instancia`, `condenacao_colegiado`, `transito_julgado`, `arquivado`, `absolvido`. A UI nunca colapsa esses estados. "Réu" e "condenado" são coisas diferentes e o app precisa gritar isso.

---

## 2. Fontes de dados

### 2.1 Camada oficial — alta confiabilidade, baixo risco

| Fonte | Endpoint | O que entrega | Custo | Dificuldade |
|---|---|---|---|---|
| **Câmara dos Deputados** | `dadosabertos.camara.leg.br/api/v2` | Proposições, autoria, tramitação, votações nominais, presença, despesas (CEAP), órgãos | Grátis | Baixa |
| **Senado Federal** | `legis.senado.leg.br/dadosabertos` | Matérias, autoria, votações, mandatos | Grátis | Baixa (XML) |
| **TSE — DivulgaCand** | `divulgacandcontas.tse.jus.br` + `dadosabertos.tse.jus.br` | Candidaturas, bens declarados, escolaridade, doadores, prestação de contas, histórico eleitoral | Grátis | Média |
| **Portal da Transparência** | `api.portaldatransparencia.gov.br` | CEIS/CNEP, contratos, servidores, benefícios | Grátis (API key) | Baixa |
| **CNJ — DataJud** | `api-publica.datajud.cnj.jus.br` | Metadados processuais unificados de todos os tribunais | Grátis (API key) | Média |
| **Diário Oficial da União** | `in.gov.br` (JSON por edição) | Nomeações, exonerações, atos | Grátis | Média |
| **TCU** | `contas.tcu.gov.br/ords/` | Acórdãos, responsáveis, contas irregulares | Grátis | Média |
| **IBGE / IPEA / Banco Central** | APIs SIDRA, ipeadata, BCB-SGS | Contexto macro para correlacionar com mandatos | Grátis | Baixa |
| **Meta Ad Library** | `graph.facebook.com/ads_archive` | **Anúncios políticos, gasto, alcance, segmentação** | Grátis | Baixa |

> A **Meta Ad Library API** é a joia escondida aqui. É pública, gratuita, obrigatória por lei para anúncios políticos, e entrega gasto declarado + alcance estimado + segmentação demográfica. Vale mais que 90% do que se conseguiria raspando timeline.

### 2.2 Camada redes sociais — realidade dura

Aqui é preciso ser direto: **acesso a redes sociais em 2026 é caro, restrito ou ambos.** O cenário real:

| Rede | Via oficial | Viabilidade |
|---|---|---|
| **YouTube** | Data API v3 — 10.000 unidades/dia grátis | ✅ **Excelente.** Canais, vídeos, views, likes, comentários |
| **Bluesky** | AT Protocol — API pública, sem chave | ✅ **Excelente.** Posts, replies, engajamento, grafo social, tudo aberto |
| **Meta Ad Library** | Graph API pública | ✅ **Excelente** (só anúncios, mas dado riquíssimo) |
| **Instagram** | Business Discovery API | ⚠️ Parcial. Exige app Meta aprovado + conta Business própria. Dá seguidores, mídias recentes, engajamento de contas Business/Creator públicas |
| **Threads** | Threads API | ⚠️ Parcial. Focada em contas próprias; leitura de terceiros é limitada |
| **Facebook Pages** | Graph API | ❌ Só páginas que você administra. Fora isso, apenas Ad Library ou Content Library |
| **X / Twitter** | API v2 — Basic ~US$200/mês (15k posts/mês) | ⚠️ Caro e apertado para o volume necessário |
| **TikTok** | Research API | ❌ Restrita a instituições acadêmicas de EUA/Europa |
| **Meta Content Library** | Acesso via ICPSR | ❌ Requer vínculo institucional de pesquisa aprovado |

**Estratégia realista para redes sociais:**

1. **Fase 1** — YouTube + Bluesky + Meta Ad Library. Cobertura gratuita, legal, e já dá um retrato forte de comunicação e investimento em propaganda.
2. **Fase 2** — Instagram via Business Discovery, se conseguir aprovação do app Meta.
3. **Fase 3** — X só se houver orçamento. Alternativa: consumir *agregados* de terceiros licenciados em vez de coletar direto.
4. **Nunca** — scraping de plataforma contra os termos de uso. Além do risco jurídico, quebra a cada mudança de front-end e inviabiliza a manutenção.

**O que medir em redes sociais (e o que não medir):**

Medir volume, cadência, engajamento relativo, temas dominantes (classificação por LLM), e coerência entre discurso e voto registrado. **Não** medir sentimento de comentários de terceiros como proxy de qualidade — é o vetor mais fácil de manipular por bot e envenenaria toda a base.

---

## 3. Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│  COLETORES (workers agendados, um por fonte)             │
│  camara · senado · tse · transparencia · datajud · dou   │
│  tcu · youtube · bluesky · meta-ads · rss-noticias       │
└────────────────────────┬─────────────────────────────────┘
                         │ payload bruto + hash + timestamp
                         ▼
┌──────────────────────────────────────────────────────────┐
│  RAW STORE  (imutável, append-only)                      │
│  Postgres JSONB / object storage — auditoria e replay    │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  NORMALIZAÇÃO                                            │
│  • parse por adaptador  • dedup por hash de conteúdo     │
│  • ENTITY RESOLUTION → chave canônica do candidato       │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  ENRIQUECIMENTO (LLM, apenas classificação/resumo)       │
│  • tema (saúde/educação/economia/ambiente/…)             │
│  • estágio jurídico do evento                            │
│  • resumo próprio de notícia (nunca texto integral)      │
│  • flag de confiança + revisão humana quando < limiar    │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  CORE DB (Postgres) + índice de busca                    │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  API (Fastify) — REST + cache                            │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│  FRONTEND (React) — perfis, comparador, painel de pesos  │
│  Cálculo do score roda NO CLIENTE                        │
└──────────────────────────────────────────────────────────┘
```

O padrão é o mesmo de uma interface AMS clássica: adaptador por origem, camada de normalização, chave canônica, e a lógica de negócio isolada da coleta. Trocar a fonte não deve tocar no core.

---

## 4. Modelo de dados

```sql
-- Identidade canônica. Chave de tudo.
candidato (
  id                uuid PK,
  nome_civil        text,
  nome_urna         text,
  cpf_hash          text,          -- hash, nunca o CPF em claro
  id_tse            text,
  id_camara         integer,
  id_senado         integer,
  partido_atual     text,
  uf                text,
  cargo_pretendido  text,
  foto_url          text
)

-- Aliases para resolução de homônimos e variações
candidato_alias (
  candidato_id  uuid FK,
  alias         text,
  origem        text,              -- 'tse' | 'imprensa' | 'social'
  confianca     numeric
)

-- Handles sociais, validados manualmente uma vez
perfil_social (
  candidato_id  uuid FK,
  plataforma    text,              -- youtube | bluesky | instagram | x
  handle        text,
  url           text,
  verificado    boolean,
  seguidores    integer,
  coletado_em   timestamptz
)

-- Tabela central: todo fato vira um evento
evento (
  id               uuid PK,
  candidato_id     uuid FK,
  tipo             text,           -- proposicao | voto | processo | sancao
                                   -- | despesa | nomeacao | post | anuncio
  categoria        text,           -- 'realizacao' | 'controversia' | 'neutro'
  estagio_juridico text,           -- só para tipo=processo. NUNCA nulo aí.
  tema             text[],         -- saude, educacao, economia, ambiente…
  titulo           text,
  resumo           text,           -- texto PRÓPRIO, gerado por nós
  data_evento      date,
  fonte_nome       text,
  fonte_url        text NOT NULL,  -- obrigatório. Sem link, não entra.
  fonte_confianca  smallint,       -- 1=oficial 2=imprensa 3=social
  payload_raw_id   uuid,
  hash_conteudo    text UNIQUE,
  revisado_humano  boolean DEFAULT false
)

-- Métricas agregadas, recalculadas por job
metrica (
  candidato_id  uuid FK,
  chave         text,   -- 'projetos_aprovados', 'presenca_pct',
                        -- 'gasto_ads_brl', 'processos_transito_julgado'
  valor         numeric,
  periodo       daterange,
  calculado_em  timestamptz
)
```

**Regras estruturais:**
- `fonte_url NOT NULL` — nenhum fato existe no app sem link para a origem
- `hash_conteudo UNIQUE` — dedup automático entre fontes que republicam o mesmo dado
- `resumo` é sempre texto gerado, nunca cópia de matéria jornalística (direito autoral)
- `payload_raw_id` permite reprocessar tudo se a lógica de classificação mudar

---

## 5. Entity resolution — onde o projeto vive ou morre

Este é o componente mais subestimado e o que mais consome esforço. O problema: "Lula", "Luiz Inácio Lula da Silva", "L. I. L. da Silva" e um homônimo qualquer precisam resolver corretamente.

**Pipeline em cascata:**

1. **Match determinístico** — CPF (hash) ou ID do TSE. Confiança 1.0, encerra.
2. **Match forte** — nome normalizado + UF + partido + ano da eleição. Confiança ~0.9.
3. **Match fuzzy** — Levenshtein/Jaro-Winkler sobre nome normalizado (sem acento, sem preposição), com desempate por contexto (cargo mencionado, partido citado no texto).
4. **Fila de revisão** — abaixo de 0.85, o registro vai para revisão humana e **não** entra nas métricas até ser resolvido.

Nunca deixar match fuzzy alimentar métrica direto. Atribuir um processo criminal ao candidato errado é o pior bug possível deste sistema.

---

## 6. Camada de metrificação

### Dimensões propostas

| Dimensão | Composição | Fonte |
|---|---|---|
| **Produção legislativa** | Proposições de autoria, taxa de aprovação, relatorias | Câmara/Senado |
| **Assiduidade** | Presença em plenário e comissões | Câmara/Senado |
| **Coerência** | Alinhamento entre discurso público e voto registrado | Social + votações |
| **Transparência** | Completude da declaração de bens, prestação de contas | TSE |
| **Integridade** | Processos por estágio jurídico, sanções CEIS/CNEP, acórdãos TCU | DataJud/CGU/TCU |
| **Uso de recursos públicos** | CEAP, contratos vinculados | Câmara/Transparência |
| **Comunicação** | Volume, cadência, temas, engajamento relativo | YouTube/Bluesky |
| **Investimento em propaganda** | Gasto declarado, alcance, segmentação | Meta Ad Library |
| **Foco temático** | Distribuição percentual de atuação por área | Todas |

### Como o score funciona

O backend entrega **apenas as métricas normalizadas** (0–100 por dimensão, com o método de normalização documentado e visível). O frontend expõe sliders de peso. O usuário arrasta, o score recalcula ao vivo.

```
score_final = Σ (metrica_normalizada[i] × peso_usuario[i]) / Σ peso_usuario[i]
```

Presets sugeridos ("foco em integridade", "foco em produção legislativa", "foco em área social") ficam disponíveis como atalho, mas sempre editáveis e sempre com os pesos visíveis. Nada de caixa-preta.

**Cada número na tela é clicável** e abre a lista de eventos que o compõem, cada um com seu link de origem. Se o usuário não puder auditar o número, o número não deveria estar lá.

---

## 7. Stack e infraestrutura

Aproveitando o que já roda no seu ambiente:

| Camada | Escolha | Justificativa |
|---|---|---|
| API | **Node.js + Fastify** | Mesmo stack do Porto Ravello, reaproveita padrão de deploy |
| Workers | **BullMQ + Redis** | Agendamento, retry com backoff, rate limit por fonte |
| Banco | **PostgreSQL 16 + pgvector** | JSONB para raw, vetor para busca semântica, tudo num banco só |
| Busca | **Postgres FTS** (`portuguese`) | Evita subir Elasticsearch no começo |
| Frontend | **React + Vite + Tailwind** | Netlify, como você já faz |
| Gráficos | **Recharts** ou **visx** | Comparador e séries temporais |
| LLM | Claude/Gemini via API | Só classificação e resumo, nunca geração de fato |
| Infra | **Oracle Cloud ARM A1.Flex** | Use a A1 (4 OCPU/24GB), não as E2.1.Micro — o pipeline é pesado |
| Deploy | Docker Compose + nginx + Certbot | Mesmo padrão já validado no seu VPS |
| Observabilidade | Healthcheck por coletor + log estruturado | Fonte que quebra silenciosamente é o pior cenário |

**Nota sobre a VM:** os coletores com LLM e o Postgres com pgvector não cabem confortavelmente numa E2.1.Micro (1GB). A A1.Flex ARM do Free Tier é o alvo certo aqui. Compilar dependências nativas em ARM às vezes dá trabalho — prefira imagens `arm64` oficiais.

---

## 8. Roadmap

### Fase 0 — Fundação (2–3 semanas)
- Schema do banco, migrations
- Framework de coletor: interface comum, retry, rate limit, raw store
- Coletor da Câmara (o mais rico e mais simples)
- Entity resolution v1, determinística
- Seed manual de 5–8 candidatos com handles sociais validados à mão

### Fase 1 — MVP navegável (3–4 semanas)
- Coletores TSE + Portal da Transparência
- API REST: perfil de candidato, timeline de eventos, métricas
- Frontend: página de perfil + timeline com fonte linkada
- **Painel de pesos funcionando** — é o diferencial, entra cedo

### Fase 2 — Redes sociais (3–4 semanas)
- YouTube Data API + Bluesky AT Protocol
- Meta Ad Library
- Métricas de comunicação e propaganda
- Classificação temática por LLM + fila de revisão humana

### Fase 3 — Integridade (3–4 semanas)
- DataJud, TCU, DOU
- Modelagem rigorosa de `estagio_juridico`
- **Revisão humana obrigatória** para todo evento de categoria `controversia`
- Componente de UI dedicado que explica cada estágio ao usuário

### Fase 4 — Comparador e polimento
- Comparação lado a lado de N candidatos
- Exportação de relatório com fontes
- Presets de peso, compartilhamento de configuração via URL
- Cache agressivo e CDN

---

## 9. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Difamação / dano à imagem** | Estágio jurídico explícito e obrigatório; revisão humana em toda controvérsia; link de origem em 100% dos fatos; canal de contestação com prazo de resposta |
| **Direito autoral (imprensa)** | Nunca armazenar ou exibir texto integral. Só título, link e resumo próprio |
| **LGPD** | Trabalhar apenas com dado público de agente político no exercício da função (art. 7º, interesse legítimo + dado manifestamente público). CPF só em hash. Nunca dado de familiares |
| **Acusação de viés** | Pesos do usuário, código do cálculo aberto, metodologia publicada, sem score default no ranking |
| **Termos de uso de plataformas** | Apenas APIs oficiais. Zero scraping de rede social |
| **Fonte oficial muda ou cai** | Adaptadores isolados, raw store permite replay, alerta por coletor sem dado há N horas |
| **Alucinação do LLM** | LLM só classifica e resume sobre texto fornecido; nunca gera fato; score de confiança e revisão abaixo do limiar |
| **Uso em período eleitoral** | Atenção à legislação eleitoral sobre propaganda e pesquisa. Vale consulta jurídica antes de publicar no período de campanha |

---

## 10. Primeiro passo concreto

Não comece pela arquitetura completa. Comece assim:

1. Suba um Postgres local
2. Escreva **um** coletor: proposições da Câmara para **um** deputado
3. Grave em `evento` com `fonte_url` preenchido
4. Renderize uma timeline React simples
5. Adicione **um** slider de peso

Se esses cinco passos funcionam de ponta a ponta, o resto é repetição de padrão. Se travar em algum, travou cedo e barato.

---

*Documento vivo — revisar a cada fase concluída.*
