import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PESO_NEUTRO } from "../data/dimensoes";
import { gerarLinkComPesos, parsePesosDaQuery } from "../lib/pesosUrl";
import type { Dimensao } from "../lib/types";

const STORAGE_KEY = "monitor-candidatos:pesos:v1";

interface WeightsContextValue {
  pesos: Record<string, number>;
  definirPeso: (chave: string, valor: number) => void;
  aplicarPreset: (pesos: Record<string, number>) => void;
  resetar: (dimensoes: Dimensao[]) => void;
  garantirChaves: (dimensoes: Dimensao[]) => void;
  presetAtivo: string | null;
  setPresetAtivo: (id: string | null) => void;
  /** Gera uma URL absoluta com os pesos atuais na query string (?pesos=chave:valor,...) */
  gerarLink: () => string;
  /** true só na primeira renderização quando os pesos vieram de um link compartilhado */
  aplicadoDaUrl: boolean;
}

const WeightsContext = createContext<WeightsContextValue | null>(null);

function lerStorage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Se a URL de entrada trouxer ?pesos=..., esses pesos têm prioridade sobre o
// que já está salvo no localStorage — é assim que "abrir um link com pesos
// aplica automaticamente" (seção 8 do roadmap). Uma vez aplicados, também
// passam a persistir localmente como qualquer outro ajuste manual.
function pesosIniciais(): { pesos: Record<string, number>; daUrl: boolean } {
  const daUrl = parsePesosDaQuery(window.location.search);
  if (daUrl) return { pesos: daUrl, daUrl: true };
  return { pesos: lerStorage(), daUrl: false };
}

export function WeightsProvider({ children }: { children: ReactNode }) {
  const [{ pesos: pesosIniciaisValor, daUrl }] = useState(pesosIniciais);
  const [pesos, setPesos] = useState<Record<string, number>>(pesosIniciaisValor);
  const [presetAtivo, setPresetAtivo] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pesos));
    } catch {
      /* localStorage indisponível — segue só em memória */
    }
  }, [pesos]);

  const definirPeso = useCallback((chave: string, valor: number) => {
    setPresetAtivo(null);
    setPesos((prev) => ({ ...prev, [chave]: valor }));
  }, []);

  const aplicarPreset = useCallback((novosPesos: Record<string, number>) => {
    setPesos((prev) => ({ ...prev, ...novosPesos }));
  }, []);

  const garantirChaves = useCallback((dimensoes: Dimensao[]) => {
    setPesos((prev) => {
      let mudou = false;
      const proximo = { ...prev };
      for (const d of dimensoes) {
        if (!(d.chave in proximo)) {
          proximo[d.chave] = PESO_NEUTRO;
          mudou = true;
        }
      }
      return mudou ? proximo : prev;
    });
  }, []);

  const resetar = useCallback((dimensoes: Dimensao[]) => {
    setPresetAtivo(null);
    const proximo: Record<string, number> = {};
    for (const d of dimensoes) proximo[d.chave] = PESO_NEUTRO;
    setPesos(proximo);
  }, []);

  const gerarLink = useCallback(() => gerarLinkComPesos(pesos), [pesos]);

  const value = useMemo(
    () => ({
      pesos,
      definirPeso,
      aplicarPreset,
      resetar,
      garantirChaves,
      presetAtivo,
      setPresetAtivo,
      gerarLink,
      aplicadoDaUrl: daUrl,
    }),
    [pesos, definirPeso, aplicarPreset, resetar, garantirChaves, presetAtivo, gerarLink, daUrl]
  );

  return <WeightsContext.Provider value={value}>{children}</WeightsContext.Provider>;
}

export function useWeights() {
  const ctx = useContext(WeightsContext);
  if (!ctx) throw new Error("useWeights precisa estar dentro de WeightsProvider");
  return ctx;
}
