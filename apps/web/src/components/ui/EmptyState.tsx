import type { ReactNode } from "react";

// Estado vazio desenhado com intenção — a API pode estar fora do ar ou o
// banco pode estar vazio (pipeline de dados em construção em paralelo).
// A UI nunca quebra; ela explica o que está acontecendo e o que fazer.
export function EmptyState({
  titulo,
  descricao,
  icone = "🗂️",
  acao,
}: {
  titulo: string;
  descricao: string;
  icone?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
      <div className="text-3xl mb-3 opacity-70" aria-hidden>
        {icone}
      </div>
      <h3 className="font-display text-lg text-ink mb-1.5">{titulo}</h3>
      <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">{descricao}</p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

export function ErroApiState({ mensagem, offline }: { mensagem: string; offline: boolean }) {
  return (
    <EmptyState
      icone={offline ? "🔌" : "⚠️"}
      titulo={offline ? "A API ainda não está no ar" : "Não foi possível carregar os dados"}
      descricao={
        offline
          ? "O backend deste projeto está sendo construído em paralelo. Assim que ele subir em VITE_API_URL, esta tela preenche sozinha."
          : mensagem
      }
    />
  );
}
