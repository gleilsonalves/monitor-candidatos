/**
 * Tradução (PARCIAL e DELIBERADAMENTE CONSERVADORA) de códigos da Tabela
 * Processual Unificada (TPU) de Movimentos do CNJ para o enum
 * `EstagioJuridico` do banco (`denuncia | investigacao_aberta |
 * acao_recebida | condenacao_1a_instancia | condenacao_colegiado |
 * transito_julgado | arquivado | absolvido`).
 *
 * LEIA ISTO ANTES DE ADICIONAR UM CÓDIGO NOVO. A regra de ouro (seção 1 do
 * documento de arquitetura, reforçada nas instruções desta tarefa): **é
 * melhor não ter o dado do que classificar errado um estágio jurídico**.
 * "Réu" e "condenado" são coisas diferentes e o app precisa gritar isso —
 * um mapeamento errado nesta tabela erra exatamente essa distinção, contra
 * uma pessoa real. Por isso este arquivo mapeia só os 2 códigos abaixo, dos
 * 8 valores do enum, e documenta explicitamente por que os outros 6 NÃO
 * foram mapeados em vez de tentar adivinhar.
 *
 * ## Fonte e método
 *
 * A Tabela Processual Unificada é mantida pelo CNJ (Resolução CNJ nº 46/2007)
 * e tem um sistema de consulta pública oficial, o SGT (Sistema de Gestão de
 * Tabelas Processuais Unificadas):
 *
 *   https://www.cnj.jus.br/sgt/consulta_publica_movimentos.php
 *
 * A página é uma UI antiga baseada em Sajax (chamadas AJAX por
 * `POST /sgt/consulta_publica_movimentos.php` com `rs=<função>`). Os dois
 * códigos abaixo foram confirmados em 2026-08-10 fazendo essas chamadas
 * diretamente (reproduzível por qualquer pessoa — não é um dado privado):
 *
 *   - função `pesquisarItemGetTabela` com args `["M", "N", "<termo>"]` busca
 *     movimentos por nome e retorna uma lista de `(cod_item, nome)`.
 *   - função `getDetalhesItem` com args `["<cod_item>", "M"]` retorna o
 *     detalhe do item: `cod_item`, `cod_item_pai` (item pai na hierarquia),
 *     `nome`, `situacao` ('A' = ativo), `cnj` ('S'/'N' — se o código é
 *     válido na tabela nacional unificada).
 *
 * O campo `cod_item` retornado por essa consulta é o mesmo "código da
 * movimentação processual conforme TPU" que a API do DataJud expõe em
 * `movimentos.codigo` — confirmado porque o Glossário de Dados oficial da
 * API do DataJud (https://datajud-wiki.cnj.jus.br/api-publica/glossario/)
 * descreve `movimentos.codigo` literalmente como "Código da movimentação
 * processual conforme TPU", e o SGT é o sistema oficial de gestão dessa
 * mesma tabela.
 *
 * ## Os 2 códigos mapeados
 *
 * ### 848 → `transito_julgado`
 *
 * Busca por "transito em julgado" no SGT retornou **um único resultado**
 * (sem ambiguidade): `cod_item=848`, `nome="Trânsito em julgado"`,
 * `cod_item_pai=48`, `cnj='S'` (código nacional válido), `situacao='A'`
 * (ativo). Nome inequívoco, sem outros sentidos possíveis — mapeado com
 * confiança alta.
 *
 * ### 246 → `arquivado`
 *
 * Busca por "arquivado definitivamente" não encontrou nada por esse texto
 * exato, mas a busca por "arquivamento" retornou vários itens; investigando
 * a hierarquia com `getDetalhesItem`:
 *   - `cod_item=861`, `nome="Arquivamento"`, `cod_item_pai=48` (mesmo pai de
 *     848 acima — ambos filhos de um nó raiz comum de "fim de processo").
 *   - `cod_item=246`, `nome="Definitivo"`, `cod_item_pai=861` — ou seja, o
 *     caminho completo na árvore é "Arquivamento > Definitivo", `cnj='S'`,
 *     `situacao='A'`.
 * Mapeamos só o código 246 (o nó folha "Definitivo"), não o 861 genérico —
 * "Arquivamento" sozinho (861) pode incluir arquivamento provisório (ex:
 * aguardando cumprimento de mandado, comum em casos de réu foragido — ver
 * os itens irmãos "Arquivamento Provisório - Aguardando Captura de Réu
 * Condenado" encontrados na mesma busca), que **não** é o mesmo fato que
 * "processo definitivamente encerrado". Só o nó "Definitivo" (246) tem
 * significado inequívoco de arquivamento no sentido do enum.
 *
 * ## Os 6 códigos NÃO mapeados — e por quê (não é preguiça, é decisão)
 *
 * - **`acao_recebida`** (o momento em que a pessoa formalmente vira "réu" —
 *   a distinção mais crítica do documento de arquitetura): a busca por
 *   "recebimento" no SGT retornou movimentos genéricos ("Recebimento",
 *   `cod_item` 115 e 132) que, pelo nome, não são exclusivos de
 *   "recebimento de denúncia ou queixa-crime" — o mesmo rótulo genérico
 *   "Recebimento" é usado na TPU para recebimento de recurso, de petição, de
 *   mandado, etc. em contextos totalmente não-criminais. Sem conseguir
 *   navegar a árvore completa do SGT (as funções de navegação por
 *   `cod_item_pai` não retornaram contexto suficiente nas chamadas feitas)
 *   para confirmar qual código específico (se algum) significa
 *   inequivocamente "recebimento da denúncia/queixa-crime", **não
 *   mapeamos** — é exatamente o tipo de ambiguidade que a seção 1 do
 *   documento de arquitetura manda tratar com o máximo de cautela.
 * - **`condenacao_1a_instancia`, `condenacao_colegiado`, `absolvido`**: a
 *   busca por "condenatória"/"absolutória" (adjetivos usados nos nomes
 *   oficiais de sentença/acórdão condenatório ou absolutório) não retornou
 *   NENHUM resultado como nome de movimento isolado. Isso é um indício
 *   estrutural real, não uma falha de busca: o resultado do julgamento
 *   (condenatório/absolutório, procedente/improcedente) parece ser
 *   registrado como um `complementosTabelados` (sub-atributo) de um
 *   movimento genérico como "Julgamento" ou "Sentença/Acórdão", não como um
 *   código de movimento próprio — a própria API do DataJud expõe
 *   `movimentos.complementosTabelados[]` (`codigo`, `valor`, `nome`,
 *   `descricao`) como uma estrutura separada dentro de cada movimento (ver
 *   exemplo oficial em `client.ts`/README). Mapear corretamente exigiria
 *   cruzar `movimentos.codigo` (ex: "Julgamento") **com**
 *   `movimentos.complementosTabelados[].codigo/valor` (ex: o código
 *   específico de "procedência"/"condenação" dentro daquele julgamento), e
 *   não foi possível verificar essa combinação contra uma chave de API real
 *   (não temos uma) nem contra a documentação pública disponível no tempo
 *   desta tarefa. Inventar essa combinação seria exatamente o erro que a
 *   tarefa pede para evitar.
 * - **`denuncia`, `investigacao_aberta`**: são estágios que, na prática,
 *   costumam anteceder a existência de um processo JUDICIAL com número
 *   único CNJ (denúncia é peça do Ministério Público; investigação é
 *   inquérito policial) — a API do DataJud só indexa processos já
 *   distribuídos a um tribunal. É possível que esses estágios apareçam,
 *   quando muito, como a `classe` do processo (ex: uma classe processual
 *   "Inquérito Policial") em vez de como um `movimento` — ou seja, a
 *   pergunta certa pode nem ser "qual código de movimento", mas "qual
 *   código de classe processual", uma tabela TPU diferente (Tabela de
 *   Classes) que não foi pesquisada nesta tarefa. Fica documentado como
 *   trabalho futuro, não como um mapeamento adivinhado.
 *
 * ## Regra de uso deste módulo
 *
 * `mapearCodigoMovimento()` retorna `null` para QUALQUER código fora dos 2
 * mapeados acima — incluindo códigos que "parecem" óbvios. O chamador
 * (`collector.ts`) trata `null` como "não crie o evento para este
 * movimento", nunca como "assuma um estágio default".
 */

import type { EstagioJuridico } from "../../types.js";

interface MovimentoMapeado {
  /** Nome oficial confirmado no SGT (não necessariamente igual ao `nome`
   * que vem no payload do DataJud — a API pode devolver só o nome do nó
   * folha, ex: "Definitivo", sem o caminho completo). */
  nomeConfirmadoNoSgt: string;
  estagio: EstagioJuridico;
}

/**
 * Único ponto de mapeamento código TPU → estágio jurídico. Ver documentação
 * completa no topo do arquivo antes de adicionar uma entrada.
 */
const MAPA_MOVIMENTO_PARA_ESTAGIO: ReadonlyMap<number, MovimentoMapeado> = new Map([
  [848, { nomeConfirmadoNoSgt: "Trânsito em julgado", estagio: "transito_julgado" }],
  [246, { nomeConfirmadoNoSgt: "Arquivamento > Definitivo", estagio: "arquivado" }],
]);

/**
 * Traduz um código de movimento TPU para `EstagioJuridico`. Retorna `null`
 * quando o código não está no mapa conservador acima — o chamador NUNCA deve
 * tratar `null` como um estágio implícito, só como "sem informação
 * suficiente para classificar este movimento com segurança".
 */
export function mapearCodigoMovimento(codigoMovimento: number): EstagioJuridico | null {
  return MAPA_MOVIMENTO_PARA_ESTAGIO.get(codigoMovimento)?.estagio ?? null;
}

/** Só para logging/depuração — nunca usado para decidir o que gravar. */
export function nomeConfirmadoParaCodigo(codigoMovimento: number): string | undefined {
  return MAPA_MOVIMENTO_PARA_ESTAGIO.get(codigoMovimento)?.nomeConfirmadoNoSgt;
}
