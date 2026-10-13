"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches;
}

type Tour = {
  id: string;
  tab: string;
  title: string;
  text: string;
  chrome: string;
  src: string;
  poster: string;
};

// Recordings of the real product. Replace the files in public/landing to refresh them.
const tours: Tour[] = [
  {
    id: "campanhas",
    tab: "Campanhas com IA",
    title: "Da ideia à campanha, sem formulário em branco.",
    text: "Descreva em uma frase o que quer enviar. A Fisga monta nome, palavras-chave, mensagem e respostas públicas, e você revisa antes de ativar.",
    chrome: "Campanhas",
    src: "/landing/tour-campanhas.mp4",
    poster: "/landing/tour-campanhas.jpg",
  },
  {
    id: "stories",
    tab: "Stories de fora",
    title: "Seus Stories, mesmo os postados fora da Fisga.",
    text: "Stories publicados direto no Instagram ficam salvos com alcance e respostas enquanto ainda estão no ar. Depois, baixe tudo em CSV.",
    chrome: "Stories",
    src: "/landing/tour-stories.mp4",
    poster: "/landing/tour-stories.jpg",
  },
  {
    id: "metricas",
    tab: "Métricas e crescimento",
    title: "Veja o que cresce e o que gera conversa.",
    text: "Alcance, curtidas, salvos e compartilhamentos, com metas de frequência e um calendário de consistência do seu perfil.",
    chrome: "Visão geral e crescimento",
    src: "/landing/tour-metricas.mp4",
    poster: "/landing/tour-metricas.jpg",
  },
  {
    id: "agenda",
    tab: "Feed e agendamento",
    title: "Planeje o feed inteiro de uma vez.",
    text: "Veja a grade, agende post a post ou suba até 60 de uma vez, com a prévia de como o perfil vai ficar.",
    chrome: "Feed e agendamento",
    src: "/landing/tour-agenda.mp4",
    poster: "/landing/tour-agenda.jpg",
  },
];

export function ProductTour() {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const [inView, setInView] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const tour = tours[active];

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (inView && !reducedMotion) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [inView, reducedMotion, active]);

  const select = useCallback((index: number) => {
    setActive(index);
    setProgress(0);
  }, []);

  return (
    <section id="demo" className="scroll-mt-24 mx-auto max-w-[1320px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="max-w-[760px]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C23E17]">Veja funcionando</p>
        <h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">A plataforma por dentro, em poucos segundos.</h2>
        <p className="mt-5 max-w-xl text-base leading-7 text-[#626267] sm:text-lg">Gravações curtas das telas reais da Fisga. Escolha um recurso para ver como ele funciona.</p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[0.78fr_1.6fr] lg:gap-10">
        <div role="tablist" aria-label="Recursos da plataforma" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {tours.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.id}
                id={`tour-tab-${item.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="tour-panel"
                onClick={() => select(index)}
                className={`group relative shrink-0 overflow-hidden rounded-2xl border px-5 py-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C23E17] lg:shrink ${
                  selected ? "border-[#C23E17]/40 bg-white shadow-[0_20px_45px_-35px_rgba(35,31,27,0.45)]" : "border-[#E2DDD1] bg-white/40 hover:bg-white/80"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className={`font-mono text-[11px] font-bold ${selected ? "text-[#C23E17]" : "text-[#9A9A9E]"}`}>0{index + 1}</span>
                  <span className={`text-sm font-bold ${selected ? "text-[#16181D]" : "text-[#55565A]"}`}>{item.tab}</span>
                </span>
                {selected && (
                  <span className="mt-3 hidden max-w-sm text-sm leading-6 text-[#626267] lg:block">{item.text}</span>
                )}
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-transparent">
                  <span
                    className="block h-full w-full origin-left bg-[#C23E17]"
                    style={{ transform: `scaleX(${selected ? progress : 0})`, transition: "transform 0.25s linear" }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${tour.id}`}>
          <div ref={frameRef} className="relative overflow-hidden rounded-[22px] border border-[#E2DDD1] bg-white shadow-[0_30px_90px_-44px_rgba(35,31,27,0.35)]">
            <div className="flex items-center gap-2 border-b border-[#EEEAE2] bg-[#FBFAF7] px-4 py-3">
              <span className="size-2.5 rounded-full bg-[#E8E2D6]" />
              <span className="size-2.5 rounded-full bg-[#E8E2D6]" />
              <span className="size-2.5 rounded-full bg-[#E8E2D6]" />
              <span className="mx-auto rounded-full bg-[#F3F1EC] px-4 py-1 text-[11px] font-medium text-[#737378]">Fisga · {tour.chrome}</span>
              <span className="w-[42px]" />
            </div>
            <video
              key={tour.id}
              ref={videoRef}
              className="block aspect-[1568/698] w-full bg-[#F6F4EF]"
              src={tour.src}
              poster={tour.poster}
              muted
              playsInline
              preload="metadata"
              aria-label={tour.title}
              onTimeUpdate={(event) => {
                const { currentTime, duration } = event.currentTarget;
                if (duration) setProgress(currentTime / duration);
              }}
              onEnded={() => select((active + 1) % tours.length)}
            />
          </div>
          <div className="mt-5 lg:hidden">
            <h3 className="font-display text-xl font-bold tracking-[-0.03em]">{tour.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[#626267]">{tour.text}</p>
          </div>
          <p className="mt-4 hidden font-display text-2xl font-bold tracking-[-0.035em] lg:block">{tour.title}</p>
          <p className="mt-3 text-xs text-[#8A8A8E]">Gravado na plataforma. Os recursos disponíveis variam conforme as permissões aprovadas pela Meta para a sua conta.</p>
        </div>
      </div>
    </section>
  );
}
