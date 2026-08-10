export interface FiltrosCandidatos {
  q: string;
  uf: string;
  partido_atual: string;
  cargo_pretendido: string;
}

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

// Valores exatos como gravados em candidato.cargo_pretendido (a API faz
// match exato via `.eq()`, então a grafia aqui precisa bater com o banco).
const CARGOS = ["Presidente", "Vice-Presidente", "Governador", "Senador", "Deputado Federal"];

export function Filters({
  filtros,
  onChange,
  partidosDisponiveis,
}: {
  filtros: FiltrosCandidatos;
  onChange: (f: FiltrosCandidatos) => void;
  partidosDisponiveis: string[];
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-2" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          value={filtros.q}
          onChange={(e) => onChange({ ...filtros, q: e.target.value })}
          placeholder="Buscar por nome…"
          className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ink placeholder:text-muted-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
        />
      </div>

      <select
        value={filtros.uf}
        onChange={(e) => onChange({ ...filtros, uf: e.target.value })}
        className="bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
      >
        <option value="">Todas as UFs</option>
        {UFS.map((uf) => (
          <option key={uf} value={uf}>
            {uf}
          </option>
        ))}
      </select>

      <select
        value={filtros.cargo_pretendido}
        onChange={(e) => onChange({ ...filtros, cargo_pretendido: e.target.value })}
        className="bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
      >
        <option value="">Todos os cargos</option>
        {CARGOS.map((cargo) => (
          <option key={cargo} value={cargo}>
            {cargo}
          </option>
        ))}
      </select>

      {partidosDisponiveis.length > 0 && (
        <select
          value={filtros.partido_atual}
          onChange={(e) => onChange({ ...filtros, partido_atual: e.target.value })}
          className="bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
        >
          <option value="">Todos os partidos</option>
          {partidosDisponiveis.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
