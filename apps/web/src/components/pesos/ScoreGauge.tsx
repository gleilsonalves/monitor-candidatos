import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

// Arco semicircular animado — "capriche na interação" (seção 6). O valor
// anima com spring ao vivo conforme os faders se movem, em vez de saltar.
export function ScoreGauge({ score, somaPesos }: { score: number | null; somaPesos: number }) {
  const valorAlvo = score ?? 0;
  const springValue = useSpring(valorAlvo, { stiffness: 120, damping: 20, mass: 0.6 });
  const [display, setDisplay] = useState(valorAlvo);

  useEffect(() => {
    springValue.set(valorAlvo);
  }, [valorAlvo, springValue]);

  useEffect(() => {
    return springValue.on("change", (v) => setDisplay(v));
  }, [springValue]);

  const radius = 84;
  const circumference = Math.PI * radius; // meio círculo
  const dashOffset = useTransform(springValue, (v) => circumference * (1 - v / 100));

  const semArredondar = somaPesos <= 0;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[220px] h-[120px]">
        <svg viewBox="0 0 220 120" className="w-full h-full overflow-visible">
          <path
            d="M 20 110 A 84 84 0 0 1 200 110"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <motion.path
            d="M 20 110 A 84 84 0 0 1 200 110"
            fill="none"
            stroke="url(#scoreGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: semArredondar ? circumference : dashOffset }}
          />
          <defs>
            <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-seal)" />
              <stop offset="100%" stopColor="var(--color-ochre)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="font-display text-4xl text-ink tabular-nums">
            {semArredondar ? "—" : Math.round(display)}
          </span>
          <span className="text-[11px] font-mono text-muted-2 uppercase tracking-wider">score final / 100</span>
        </div>
      </div>
      {semArredondar && (
        <p className="text-xs text-muted mt-1 text-center max-w-[14rem]">
          Ajuste ao menos um peso acima de zero para calcular o score.
        </p>
      )}
    </div>
  );
}
