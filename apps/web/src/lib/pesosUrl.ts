// Compartilhamento de pesos via URL (Fase 4, seção 8: "compartilhamento de
// configuração via URL"). Formato deliberadamente legível/editável à mão:
//
//   ?pesos=integridade:80,producao_legislativa:20,transparencia:60
//
// Cada peso é 0-100 (mesma escala do resto do app — ver score.ts). Chaves
// desconhecidas não quebram nada: o WeightsContext só usa o que reconhece
// e `garantirChaves` preenche o resto com peso neutro.

const PARAM = "pesos";

export function parsePesosDaQuery(search: string): Record<string, number> | null {
  const params = new URLSearchParams(search);
  const raw = params.get(PARAM);
  if (!raw) return null;

  const pesos: Record<string, number> = {};
  for (const par of raw.split(",")) {
    const [chaveBruta, valorBruto] = par.split(":");
    const chave = chaveBruta?.trim();
    if (!chave || valorBruto === undefined) continue;
    const valor = Number(valorBruto);
    if (!Number.isFinite(valor)) continue;
    pesos[chave] = Math.min(100, Math.max(0, Math.round(valor)));
  }

  return Object.keys(pesos).length > 0 ? pesos : null;
}

export function serializarPesosParaQuery(pesos: Record<string, number>): string {
  return Object.entries(pesos)
    .map(([chave, valor]) => `${chave}:${Math.round(valor)}`)
    .join(",");
}

export function gerarLinkComPesos(pesos: Record<string, number>, urlBase: string = window.location.href): string {
  const url = new URL(urlBase);
  url.searchParams.set(PARAM, serializarPesosParaQuery(pesos));
  return url.toString();
}
