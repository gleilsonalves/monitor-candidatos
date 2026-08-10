// Exportação de relatório (Fase 4, seção 8). Duas saídas, nenhuma com
// dependência nova:
//
//  1. Impressão → window.print() com folha @media print dedicada
//     (src/index.css). "Salvar como PDF" é nativo em todo navegador — é a
//     forma mais simples de gerar um PDF sem biblioteca.
//  2. Markdown para download (Blob + <a download>) — texto puro,
//     versionável, cola em qualquer lugar, e mais fácil de auditar
//     programaticamente que um PDF.
//
// Regra inegociável: nunca exportar um número sem a proveniência. Toda
// dimensão carrega sua fonte declarada (Dimensao.fonte) e todo evento
// listado carrega fonte_url. Estágio jurídico nunca é resumido — sempre o
// rótulo específico de ESTAGIO_JURIDICO.

import { ESTAGIO_JURIDICO } from "../data/estagioJuridico";
import { TIPO_EVENTO_META } from "../data/eventoMeta";
import { formatarData } from "./format";
import type { ScoreResult } from "./score";
import type { CandidatoDetalhe, Dimensao, Evento } from "./types";

function linhaEvento(ev: Evento): string {
  const tipoMeta = TIPO_EVENTO_META[ev.tipo];
  const partes = [`**${formatarData(ev.data_evento)}** — ${ev.titulo}`, `(${tipoMeta?.rotulo ?? ev.tipo})`];
  if (ev.tipo === "processo" && ev.estagio_juridico) {
    const estagio = ESTAGIO_JURIDICO[ev.estagio_juridico];
    partes.push(`— **estágio: ${estagio?.rotulo ?? ev.estagio_juridico}**`);
  }
  partes.push(`— fonte: [${ev.fonte_nome}](${ev.fonte_url})`);
  return "- " + partes.join(" ");
}

function tabelaScore(scoreResult: ScoreResult, dimensoesPorChave: Map<string, Dimensao>, pesos: Record<string, number>): string[] {
  const linhas: string[] = [];
  linhas.push("| Dimensão | Peso | Valor normalizado | Fonte declarada |");
  linhas.push("|---|---|---|---|");
  for (const item of scoreResult.itens) {
    const dim = dimensoesPorChave.get(item.chave);
    linhas.push(
      `| ${dim?.nome ?? item.chave} | ${pesos[item.chave] ?? item.peso} | ${
        item.valor === null ? "sem dado" : Math.round(item.valor)
      } | ${dim?.fonte ?? "—"} |`
    );
  }
  return linhas;
}

export function gerarMarkdownCandidato({
  candidato,
  eventos,
  scoreResult,
  dimensoesPorChave,
  pesos,
}: {
  candidato: CandidatoDetalhe;
  eventos: Evento[];
  scoreResult: ScoreResult;
  dimensoesPorChave: Map<string, Dimensao>;
  pesos: Record<string, number>;
}): string {
  const linhas: string[] = [];
  linhas.push(`# Relatório — ${candidato.nome_urna}`);
  linhas.push("");
  linhas.push(
    `${candidato.cargo_pretendido ?? "Candidato"} · ${
      [candidato.partido_atual, candidato.uf].filter(Boolean).join(" · ") || "partido/UF não informados"
    }`
  );
  if (candidato.nome_civil && candidato.nome_civil !== candidato.nome_urna) {
    linhas.push(`Nome civil: ${candidato.nome_civil}`);
  }
  linhas.push("");
  linhas.push(
    `Gerado em ${new Date().toLocaleString("pt-BR")}. O score é calculado no navegador do usuário a partir de pesos que ele mesmo escolhe — nunca em servidor, nunca um veredito do site.`
  );
  linhas.push("");
  linhas.push("## Score com os pesos usados nesta exportação");
  linhas.push("");
  linhas.push(`**Score final:** ${scoreResult.score !== null ? Math.round(scoreResult.score) : "sem dado suficiente"} / 100`);
  linhas.push("");
  linhas.push(...tabelaScore(scoreResult, dimensoesPorChave, pesos));
  linhas.push("");
  linhas.push("## Linha do tempo de eventos (com fonte)");
  linhas.push("");
  if (eventos.length === 0) {
    linhas.push("_Nenhum evento publicado para este candidato ainda._");
  } else {
    const ordenados = [...eventos].sort((a, b) => new Date(b.data_evento).getTime() - new Date(a.data_evento).getTime());
    for (const ev of ordenados) linhas.push(linhaEvento(ev));
  }
  linhas.push("");
  linhas.push("---");
  linhas.push(
    "_Este relatório não emite veredito. Metodologia completa em /metodologia. Réu não é condenado — condenado em 1ª instância não é condenação definitiva; ver o estágio jurídico específico de cada processo acima._"
  );
  return linhas.join("\n");
}

export interface EntradaComparador {
  candidato: CandidatoDetalhe;
  eventos: Evento[];
  scoreResult: ScoreResult;
}

export function gerarMarkdownComparador({
  entradas,
  dimensoes,
  pesos,
}: {
  entradas: EntradaComparador[];
  dimensoes: Dimensao[];
  pesos: Record<string, number>;
}): string {
  const linhas: string[] = [];
  linhas.push("# Comparação de candidatos");
  linhas.push("");
  linhas.push(
    `Gerado em ${new Date().toLocaleString("pt-BR")} com os pesos do usuário — calculado no navegador, nunca em servidor.`
  );
  linhas.push("");
  linhas.push("## Score com os pesos atuais");
  linhas.push("");
  const cabecalho = ["Dimensão", "Peso", ...entradas.map((e) => e.candidato.nome_urna)];
  linhas.push(`| ${cabecalho.join(" | ")} |`);
  linhas.push(`|${cabecalho.map(() => "---").join("|")}|`);
  linhas.push(
    `| **Score final** | — | ${entradas
      .map((e) => (e.scoreResult.score !== null ? `**${Math.round(e.scoreResult.score)}**` : "sem dado"))
      .join(" | ")} |`
  );
  for (const dim of dimensoes) {
    const linha = [dim.nome, String(pesos[dim.chave] ?? "—")];
    for (const e of entradas) {
      const item = e.scoreResult.itens.find((i) => i.chave === dim.chave);
      linha.push(item?.valor === null || item?.valor === undefined ? "sem dado" : String(Math.round(item.valor)));
    }
    linhas.push(`| ${linha.join(" | ")} |`);
  }
  linhas.push("");
  linhas.push(`_Fonte declarada por dimensão: ${dimensoes.map((d) => `${d.nome} — ${d.fonte}`).join("; ")}._`);
  linhas.push("");

  for (const e of entradas) {
    linhas.push(`## ${e.candidato.nome_urna}`);
    linhas.push("");
    linhas.push(
      `${e.candidato.cargo_pretendido ?? "Candidato"} · ${
        [e.candidato.partido_atual, e.candidato.uf].filter(Boolean).join(" · ") || "—"
      }`
    );
    linhas.push("");
    if (e.eventos.length === 0) {
      linhas.push("_Nenhum evento publicado ainda._");
    } else {
      const ordenados = [...e.eventos].sort((a, b) => new Date(b.data_evento).getTime() - new Date(a.data_evento).getTime());
      for (const ev of ordenados) linhas.push(linhaEvento(ev));
    }
    linhas.push("");
  }

  linhas.push("---");
  linhas.push(
    "_Comparação sem veredito: os pesos são do usuário, cada métrica vem de fonte pública linkada acima, estágios jurídicos nunca são colapsados em um rótulo genérico._"
  );
  return linhas.join("\n");
}

export function baixarArquivoTexto(nomeArquivo: string, conteudo: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function nomeArquivoSeguro(base: string): string {
  const semAcentos = base.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (
    semAcentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "relatorio"
  );
}
