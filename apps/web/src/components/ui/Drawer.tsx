import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";

export function Drawer({
  aberto,
  onFechar,
  titulo,
  subtitulo,
  children,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [aberto, onFechar]);

  return (
    <AnimatePresence>
      {aberto && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onFechar}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            className="fixed right-0 top-0 h-full w-full sm:w-[26rem] bg-surface border-l border-border z-50 flex flex-col shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 300 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="font-display text-lg text-ink leading-tight">{titulo}</h2>
                {subtitulo && <p className="text-xs text-muted mt-1">{subtitulo}</p>}
              </div>
              <button
                onClick={onFechar}
                aria-label="Fechar"
                className="shrink-0 h-8 w-8 rounded-full border border-border flex items-center justify-center text-muted hover:text-ink hover:border-ochre transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
