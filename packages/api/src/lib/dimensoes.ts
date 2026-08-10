/**
 * As 9 dimensões de metrificação descritas na seção 6 do documento de
 * arquitetura (projeto-monitor-candidatos.md). Endpoint estático — não
 * depende do banco.
 *
 * Convenção de chaves: `chave` aqui é o PREFIXO usado nas linhas de
 * `metrica.chave` no banco. Cada métrica concreta é `<dimensao>.<metrica>`,
 * por exemplo:
 *   - producao_legislativa.projetos_aprovados
 *   - producao_legislativa.taxa_aprovacao
 *   - assiduidade.presenca_pct
 *   - integridade.processos_transito_julgado
 *   - investimento_propaganda.gasto_ads_brl
 *
 * O frontend usa essas chaves para agrupar métricas normalizadas (0–100)
 * por dimensão no painel de pesos. A normalização e o texto de cada
 * métrica concreta ficam a cargo de quem grava em `metrica` (workers);
 * este endpoint só documenta as dimensões-mãe e sua fonte.
 */

export interface Dimensao {
  chave: string;
  nome: string;
  descricao: string;
  fonte: string;
}

export const DIMENSOES: Dimensao[] = [
  {
    chave: "producao_legislativa",
    nome: "Produção legislativa",
    descricao:
      "Proposições de autoria do candidato, taxa de aprovação dessas proposições e relatorias assumidas.",
    fonte: "Câmara dos Deputados / Senado Federal (dados abertos)",
  },
  {
    chave: "assiduidade",
    nome: "Assiduidade",
    descricao:
      "Presença registrada em sessões de plenário e reuniões de comissão.",
    fonte: "Câmara dos Deputados / Senado Federal (dados abertos)",
  },
  {
    chave: "coerencia",
    nome: "Coerência",
    descricao:
      "Alinhamento entre o discurso público do candidato (redes sociais) e o voto registrado em plenário.",
    fonte: "Redes sociais (YouTube/Bluesky) cruzado com votações nominais",
  },
  {
    chave: "transparencia",
    nome: "Transparência",
    descricao:
      "Completude da declaração de bens e da prestação de contas de campanha.",
    fonte: "TSE — DivulgaCand / dados abertos TSE",
  },
  {
    chave: "integridade",
    nome: "Integridade",
    descricao:
      "Processos judiciais por estágio jurídico (nunca colapsados), sanções CEIS/CNEP e acórdãos do TCU.",
    fonte: "CNJ DataJud / Portal da Transparência (CEIS/CNEP) / TCU",
  },
  {
    chave: "uso_recursos_publicos",
    nome: "Uso de recursos públicos",
    descricao:
      "Gastos de cota parlamentar (CEAP) e contratos públicos vinculados ao candidato ou a entidades ligadas a ele.",
    fonte: "Câmara dos Deputados (CEAP) / Portal da Transparência",
  },
  {
    chave: "comunicacao",
    nome: "Comunicação",
    descricao:
      "Volume e cadência de publicação, temas dominantes e engajamento relativo nas redes sociais oficiais.",
    fonte: "YouTube Data API / Bluesky AT Protocol",
  },
  {
    chave: "investimento_propaganda",
    nome: "Investimento em propaganda",
    descricao:
      "Gasto declarado em anúncios políticos, alcance estimado e segmentação demográfica.",
    fonte: "Meta Ad Library API",
  },
  {
    chave: "foco_tematico",
    nome: "Foco temático",
    descricao:
      "Distribuição percentual da atuação do candidato por área temática (saúde, educação, economia, ambiente, etc).",
    fonte: "Agregação de todas as fontes, classificada por tema",
  },
];
