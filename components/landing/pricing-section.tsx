"use client";

import Link from "next/link";
import { useState } from "react";

type Plan = {
  name: string;
  monthly: number;
  annual: number;
  tagline: string;
  features: string[];
  highlight?: boolean;
};

const plans: Plan[] = [
  {
    name: "Grátis",
    monthly: 0,
    annual: 0,
    tagline: "Para testar a primeira campanha.",
    features: [
      "1 conta de Instagram",
      "500 DMs por mês",
      "3 campanhas ativas",
      "5 posts ou Stories agendados por mês",
      "Marca “Feito com Fisga” na DM",
    ],
  },
  {
    name: "Pro",
    monthly: 59,
    annual: 49,
    tagline: "Para criadores e lojas com uma conta.",
    highlight: true,
    features: [
      "1 conta de Instagram",
      "3.000 DMs por mês",
      "Campanhas ilimitadas",
      "Agendamento ilimitado de posts e Stories",
      "Exigir seguir antes de receber e links rastreados",
      "Sem marca na DM",
    ],
  },
  {
    name: "Agências",
    monthly: 149,
    annual: 124,
    tagline: "Para freelancers e agências com vários clientes.",
    features: [
      "5 contas de Instagram (conta extra R$25)",
      "15.000 DMs por mês",
      "Campanhas e agendamento ilimitados",
      "Relatório compartilhável por cliente",
      "3 convites de equipe",
    ],
  },
];

const brl = (value: number) => `R$${value}`;

export function PricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="planos" className="scroll-mt-24 mx-auto max-w-[1320px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-[720px]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C23E17]">Planos</p>
          <h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">
            Preço fixo em reais. Sem cobrança por contato.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#626267] sm:text-lg">
            Comece grátis e pague só quando precisar de mais DMs ou de mais contas.
          </p>
        </div>
        <div role="group" aria-label="Periodicidade de cobrança" className="inline-flex self-start rounded-full border border-[#D5CFC3] bg-white p-1 text-sm font-semibold md:self-auto">
          <button
            type="button"
            aria-pressed={!annual}
            onClick={() => setAnnual(false)}
            className={`min-h-10 rounded-full px-5 transition ${!annual ? "bg-[#16181D] text-white" : "text-[#55565A] hover:text-[#16181D]"}`}
          >
            Mensal
          </button>
          <button
            type="button"
            aria-pressed={annual}
            onClick={() => setAnnual(true)}
            className={`min-h-10 rounded-full px-5 transition ${annual ? "bg-[#16181D] text-white" : "text-[#55565A] hover:text-[#16181D]"}`}
          >
            Anual <span className={annual ? "text-[#FF9870]" : "text-[#C23E17]"}>−17%</span>
          </button>
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const price = annual ? plan.annual : plan.monthly;
          return (
            <article
              key={plan.name}
              className={`flex flex-col rounded-[26px] border p-7 sm:p-8 ${
                plan.highlight ? "border-[#C23E17] bg-white shadow-[0_20px_45px_-35px_rgba(194,62,23,0.55)]" : "border-[#E2DDD1] bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl font-bold tracking-[-0.035em]">{plan.name}</h3>
                {plan.highlight && (
                  <span className="rounded-full bg-[#FCE8DE] px-3 py-1 text-[11px] font-bold text-[#C23E17]">Mais escolhido</span>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-[#626267]">{plan.tagline}</p>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-5xl font-bold tracking-[-0.05em]">{brl(price)}</span>
                <span className="text-sm text-[#737378]">{plan.monthly === 0 ? "para sempre" : "/mês"}</span>
              </p>
              <p className="mt-1 min-h-5 text-xs text-[#737378]">
                {plan.monthly > 0 && annual && `Cobrado anualmente: ${brl(plan.annual * 12)} por ano`}
                {plan.monthly > 0 && !annual && `ou ${brl(plan.annual)}/mês no plano anual`}
              </p>
              <ul className="mt-6 flex-1 space-y-3 text-sm leading-6 text-[#34363A]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-[#C23E17]" fill="none">
                      <path d="m4.5 10.5 3.25 3.25L15.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/login?callbackUrl=${encodeURIComponent("/dashboard")}`}
                className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C23E17] ${
                  plan.highlight
                    ? "bg-[#C23E17] text-white hover:bg-[#A93212]"
                    : "border border-[#D5CFC3] bg-white/50 text-[#27292D] hover:border-[#C23E17]"
                }`}
              >
                {plan.monthly === 0 ? "Começar grátis" : `Escolher ${plan.name}`}
              </Link>
            </article>
          );
        })}
      </div>

      <p className="mt-6 max-w-2xl text-xs leading-6 text-[#737378]">
        Valores sujeitos a ajuste durante o beta. A conexão de contas depende das permissões aprovadas pela Meta.
      </p>
    </section>
  );
}
