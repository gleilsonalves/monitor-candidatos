import { EstagioLegenda } from "../components/ui/EstagioLegenda";
import { EmptyState, ErroApiState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { dimensaoIcone } from "../data/dimensoes";

export function Metodologia() {
  const dimensoesState = useApi(() => api.listarDimensoes(), []);
  const dimensoes = dimensoesState.data ?? [];

  return (
    <div className="max-w-3xl space-y-12">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-bright mb-2">Metodologia</p>
        <h1 className="font-display text-3xl text-ink">Este site não emite veredito</h1>
        <p className="text-sm text-ink-dim mt-3 leading-relaxed">
          Reunimos fatos verificáveis sobre candidatos à Presidência, cada um com link para a fonte oficial. Não
          publicamos um ranking padrão nem uma nota "objetiva" de candidato nenhum — o score que você vê em cada
          perfil é calculado no seu navegador, a partir dos pesos que você mesmo escolhe. Isso não é um detalhe
          técnico: é a decisão editorial central do projeto. O viés, se houver, é declaradamente seu.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-ink">A fórmula</h2>
        <div className="rounded-xl border border-border bg-surface-2 p-5 font-mono text-sm text-ink-dim overflow-x-auto">
          score_final = Σ (métrica_normalizada[i] × peso_usuário[i]) / Σ peso_usuário[i]
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Cada métrica é normalizada de 0 a 100 pelo backend, com o método documentado por dimensão (ver lista
          abaixo). Os pesos vão de 0 a 100 e você controla todos os nove ao mesmo tempo no{" "}
          <a href="/pesos" className="text-seal-bright hover:text-ochre-bright underline underline-offset-4">
            painel de pesos
          </a>
          . Nada é enviado a um servidor — feche a aba e o cálculo desaparece.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-ink">As 9 dimensões</h2>
        {dimensoesState.loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : dimensoesState.error ? (
          <ErroApiState mensagem={dimensoesState.error} offline={dimensoesState.offline} />
        ) : dimensoes.length === 0 ? (
          <EmptyState icone="🧮" titulo="Ainda não publicadas" descricao="A rota /dimensoes ainda não retornou dados." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {dimensoes.map((d) => (
              <div key={d.chave} className="rounded-lg border border-border bg-surface p-4">
                <p className="text-lg mb-1" aria-hidden>
                  {dimensaoIcone(d.chave)}
                </p>
                <h3 className="font-display text-base text-ink">{d.nome}</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">{d.descricao}</p>
                <p className="text-[11px] font-mono text-muted-2 mt-2">fonte: {d.fonte}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-ink">Estágio jurídico — a regra que não muda</h2>
        <p className="text-sm text-muted leading-relaxed">
          Todo processo judicial associado a um candidato carrega um estágio explícito. Réu não é condenado; condenado
          em 1ª instância não é condenação definitiva. Nunca resumimos isso em um selo genérico.
        </p>
        <EstagioLegenda />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl text-ink">O que fazemos e o que não fazemos</h2>
        <ul className="space-y-2 text-sm text-ink-dim">
          <li>· Todo fato tem link direto para a fonte pública original.</li>
          <li>· Nunca reproduzimos texto integral de matérias — resumos são redigidos por nós.</li>
          <li>· Eventos de categoria controvérsia passam por revisão humana antes de publicação.</li>
          <li>· Não medimos sentimento de comentários de terceiros como proxy de qualidade — é o vetor mais fácil de manipular por bot.</li>
          <li>· Não existe um ranking "oficial" do site: sem pesos escolhidos por você, não há score.</li>
        </ul>
      </section>
    </div>
  );
}
