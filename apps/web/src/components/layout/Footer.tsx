export function Footer() {
  return (
    <footer className="no-print border-t border-border-soft mt-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <p className="text-xs text-muted-2 leading-relaxed max-w-lg">
          Este site não emite veredito. Cada fato exibido tem fonte pública linkada; cada score é calculado no seu
          navegador, a partir dos pesos que você escolhe.
        </p>
        <p className="font-mono text-[11px] text-muted-2">dado público · fonte auditável · sem viés editorial embutido</p>
      </div>
    </footer>
  );
}
