import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const CONGRESSO_IMG =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Fachada%20do%20Congresso%20Nacional%20(48079594148).jpg?width=1600";

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border isolate">
      <div className="absolute inset-0 -z-10">
        <img
          src={CONGRESSO_IMG}
          alt=""
          aria-hidden
          className="h-full w-full object-cover opacity-[0.32] scale-[1.04]"
          loading="eager"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,14,20,0.55) 0%, rgba(11,14,20,0.88) 62%, var(--color-bg) 100%)",
          }}
        />
        <div className="paper-grain absolute inset-0 opacity-30" />
      </div>

      <div className="px-6 sm:px-12 py-16 sm:py-24 max-w-3xl">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="font-mono text-xs uppercase tracking-[0.25em] text-ochre-bright mb-4"
        >
          Dados públicos · Presidência da República
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.05 }}
          className="font-display text-4xl sm:text-5xl leading-[1.08] text-ink"
        >
          Fato. Fonte.
          <br />
          <span className="text-ochre-bright">O peso, você decide.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12 }}
          className="mt-5 text-base text-ink-dim leading-relaxed max-w-xl"
        >
          Este painel não julga candidatos. Ele reúne dados públicos com fonte linkada e deixa você calibrar o que
          importa — produção legislativa, integridade, comunicação, o que for. Duas pessoas com valores diferentes
          saem com rankings diferentes da mesma base de fatos.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.18 }}
          className="mt-8 flex flex-wrap gap-3"
        >
          <Link
            to="/pesos"
            className="rounded-full bg-ochre text-[#14100a] font-medium text-sm px-5 py-2.5 hover:bg-ochre-bright transition-colors"
          >
            Calibrar meus pesos
          </Link>
          <a
            href="#candidatos"
            className="rounded-full border border-border-soft text-ink-dim font-medium text-sm px-5 py-2.5 hover:border-seal hover:text-ink transition-colors"
          >
            Ver candidatos
          </a>
        </motion.div>
      </div>
    </section>
  );
}
