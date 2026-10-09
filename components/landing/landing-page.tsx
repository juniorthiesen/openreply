import Link from "next/link";
import { connection } from "next/server";
import { BrandLogo, BrandMark } from "@/components/brand-logo";
import { isLandingPricingEnabled } from "@/lib/env";
import { PricingSection } from "@/components/landing/pricing-section";

export type LandingVariant = "a" | "b";

const appUrl = (path: string) => `/login?callbackUrl=${encodeURIComponent(path)}`;

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none">
      <path d="M5 15 15 5M6 5h9v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
      <path d="m4.5 10.5 3.25 3.25L15.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const faqs = [
  {
    question: "Preciso informar minha senha do Instagram?",
    answer:
      "Não. A conexão é feita pelo fluxo oficial da Meta. A Fisga não pede sua senha do Instagram.",
  },
  {
    question: "Que tipo de conta posso conectar?",
    answer:
      "É necessário conectar uma conta profissional do Instagram e autorizar as permissões solicitadas pela Meta. Os recursos disponíveis dependem da conta e das permissões concedidas.",
  },
  {
    question: "Posso publicar e agendar Stories?",
    answer:
      "Sim. A Fisga permite preparar e agendar Stories, acompanhar métricas disponíveis e duplicar sequências para revisar antes de publicar novamente.",
  },
  {
    question: "A Fisga também agenda posts e carrosséis?",
    answer:
      "Sim. Você pode preparar publicações, carrosséis e lotes de conteúdo, revisar a prévia e organizar o calendário de publicação.",
  },
  {
    question: "Como começo a usar?",
    answer:
      "Entre com seu e-mail pelo link seguro enviado para sua caixa de entrada. Depois, conecte sua conta profissional do Instagram para configurar o espaço de trabalho.",
  },
];

export async function LandingPage({ variant = "a" }: { variant?: LandingVariant }) {
  // Read per request, not at build time, so the flag can change without a rebuild.
  await connection();
  const showPricing = isLandingPricingEnabled();
  return (
    <main data-lp-variant={variant} className="min-h-screen overflow-hidden bg-[#F6F4EF] text-[#16181D]">
      <header className="sticky top-0 z-40 border-b border-[#E2DDD1] bg-[#F6F4EF]/95 backdrop-blur">
        <div className="mx-auto flex h-[76px] max-w-[1320px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Fisga, página inicial">
            <BrandLogo size={40} />
          </Link>
          <nav aria-label="Navegação principal" className="hidden items-center gap-8 md:flex">
            <a className="text-sm text-[#595A5D] transition hover:text-[#C23E17]" href="#como">Como funciona</a>
            <a className="text-sm text-[#595A5D] transition hover:text-[#C23E17]" href="#recursos">Recursos</a>
            {showPricing && <a className="text-sm text-[#595A5D] transition hover:text-[#C23E17]" href="#planos">Planos</a>}
            <a className="text-sm text-[#595A5D] transition hover:text-[#C23E17]" href="#faq">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/login" className="hidden px-2 py-2 text-sm font-semibold text-[#34363A] transition hover:text-[#C23E17] sm:inline-flex">
              Entrar
            </Link>
            <Link href={appUrl("/dashboard")} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#C23E17] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#A93212] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C23E17]">
              Acessar a Fisga <ArrowUpRight />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1320px] items-center gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12 lg:pt-28">
        <div className="relative z-10">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#E2DDD1] bg-white/70 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#55565A]">
            <span className="size-2 rounded-full bg-[#F26B3A]" />
            Instagram, da conversa à análise
          </p>
          <h1 className="max-w-[760px] font-display text-[clamp(3.15rem,6.5vw,6.15rem)] font-bold leading-[0.98] tracking-[-0.065em]">
            Cada comentário abre uma <span className="text-[#C23E17]">conversa.</span>
          </h1>
          <p className="mt-7 max-w-[580px] text-lg leading-8 text-[#55565A] sm:text-xl sm:leading-9">
            Automatize respostas, organize suas publicações e descubra o que está funcionando no seu Instagram, sem perder o toque humano.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={appUrl("/dashboard")} className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-[#C23E17] px-7 text-base font-bold text-white transition hover:bg-[#A93212] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C23E17]">
              Acessar a plataforma <ArrowUpRight />
            </Link>
            <a href="#como" className="inline-flex min-h-14 items-center justify-center rounded-full border border-[#D5CFC3] bg-white/50 px-7 text-base font-semibold text-[#27292D] transition hover:border-[#C23E17] hover:bg-white">
              Ver como funciona
            </a>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-[#626267]">
            <span className="inline-flex items-center gap-2"><CheckIcon /> Conexão oficial da Meta</span>
            <span className="inline-flex items-center gap-2"><CheckIcon /> Sem compartilhar sua senha</span>
            <span className="inline-flex items-center gap-2"><CheckIcon /> Campanhas e conteúdo no mesmo lugar</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[560px] lg:mr-2">
          <div className="absolute -right-8 -top-12 size-48 rounded-full bg-[#F26B3A]/15 blur-3xl" />
          <div className="absolute -bottom-10 -left-12 size-52 rounded-full bg-[#E2DDD1] blur-3xl" />
          <div className="relative rounded-[32px] border border-[#E2DDD1] bg-white p-3 shadow-[0_30px_90px_-44px_rgba(35,31,27,0.3)] sm:p-5">
            <div className="flex items-center justify-between border-b border-[#EEEAE2] px-2 pb-4 sm:px-3">
              <div className="flex items-center gap-3">
                <BrandMark size={40} />
                <div>
                  <p className="text-sm font-bold">Campanha ativa</p>
                  <p className="mt-0.5 text-xs text-[#737378]">Comentário para mensagem</p>
                </div>
              </div>
              <span className="rounded-full bg-[#E5F2E8] px-3 py-1.5 text-[11px] font-bold text-[#26703A]">Conectada</span>
            </div>
            <div className="space-y-4 px-2 py-5 sm:px-3 sm:py-7">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#F0E7DB] text-xs font-bold">@</span>
                <div className="max-w-[82%] rounded-2xl rounded-tl-md bg-[#F3F1EC] px-4 py-3">
                  <p className="text-xs font-bold text-[#393A3E]">Novo comentário</p>
                  <p className="mt-1 text-sm leading-6 text-[#55565A]">“LINK, por favor! ✨”</p>
                </div>
              </div>
              <div className="ml-auto flex max-w-[88%] items-start gap-3">
                <div className="rounded-2xl rounded-tr-md bg-[#C23E17] px-4 py-3 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/75">Resposta privada</p>
                  <p className="mt-1 text-sm leading-6">Oi! Vi que você pediu o link. Aqui está o material que mencionei 👇</p>
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">Abrir material <ArrowUpRight /></span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-[#E2DDD1] bg-[#FBFAF7] px-4 py-3">
                <span className="grid size-8 place-items-center rounded-full bg-[#FCE8DE] text-[#C23E17]"><CheckIcon /></span>
                <div>
                  <p className="text-xs font-bold">Fluxo acompanhado</p>
                  <p className="mt-0.5 text-[11px] text-[#737378]">Comentário, resposta e link em um só lugar</p>
                </div>
                <span className="ml-auto text-[10px] text-[#737378]">Prévia ilustrativa</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-[#F7F5F0] px-4 py-3 text-xs">
              <span className="font-semibold text-[#55565A]">Palavra-chave monitorada</span>
              <span className="rounded-md bg-white px-2.5 py-1 font-mono font-bold text-[#C23E17]">LINK</span>
            </div>
          </div>
          <div className="absolute -bottom-7 right-3 hidden items-center gap-3 rounded-2xl border border-[#E2DDD1] bg-white px-4 py-3 shadow-lg sm:flex">
            <span className="grid size-9 place-items-center rounded-xl bg-[#FCE8DE] text-[#C23E17]"><ArrowUpRight /></span>
            <div><p className="text-xs font-bold">Da publicação ao resultado</p><p className="mt-0.5 text-[11px] text-[#737378]">Campanhas · Agenda · Crescimento</p></div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#E2DDD1] bg-white/55">
        <div className="mx-auto grid max-w-[1320px] gap-7 px-5 py-9 sm:px-8 md:grid-cols-3 md:gap-10">
          {[
            ["01", "Responda no momento certo", "Transforme comentários com intenção em conversas privadas, com campanhas ligadas às suas publicações."],
            ["02", "Mantenha o conteúdo em movimento", "Prepare posts, carrosséis e Stories e organize o que vai ao ar pela agenda."],
            ["03", "Decida com contexto", "Acompanhe métricas e compare formatos para planejar os próximos conteúdos com mais clareza."],
          ].map(([number, title, description]) => (
            <article key={number} className="flex gap-4">
              <span className="font-mono text-xs font-bold text-[#C23E17]">{number}</span>
              <div><h2 className="font-display text-lg font-bold tracking-tight">{title}</h2><p className="mt-2 text-sm leading-6 text-[#66666A]">{description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section id="como" className="mx-auto max-w-[1320px] scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32">
        <div className="max-w-[720px]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C23E17]">Como funciona</p>
          <h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">Três passos para sua próxima conversa.</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#626267] sm:text-lg">Você define a campanha e a Fisga acompanha os comentários para executar o fluxo autorizado pela Meta.</p>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            { num: "01", title: "Conecte seu Instagram", text: "Autorize sua conta profissional pelo processo oficial da Meta. Sua senha não é compartilhada com a Fisga." },
            { num: "02", title: "Escolha o post e a palavra", text: "Defina a publicação, as palavras-chave, a resposta pública e a mensagem privada da campanha." },
            { num: "03", title: "Acompanhe o que acontece", text: "Veja interações e links acompanhados para entender como a campanha está funcionando." },
          ].map((step) => (
            <article key={step.num} className="group min-h-[250px] rounded-[26px] border border-[#E2DDD1] bg-white p-7 transition hover:-translate-y-1 hover:shadow-[0_20px_45px_-35px_rgba(35,31,27,0.45)] sm:p-8">
              <span className="font-mono text-xs font-bold text-[#C23E17]">{step.num} / 03</span>
              <h3 className="mt-12 font-display text-2xl font-bold tracking-[-0.035em]">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[#626267]">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="recursos" className="scroll-mt-24 bg-[#16181D] text-white">
        <div className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 sm:py-32">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-[760px]"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F26B3A]">Um espaço de trabalho para Instagram</p><h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">Da campanha ao calendário. Sem perder o fio.</h2></div>
            <p className="max-w-sm text-sm leading-7 text-white/60">Ferramentas conectadas para planejar, publicar e aprender com o conteúdo do seu perfil.</p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-12">
            <article className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#22252A] p-7 sm:p-9 lg:col-span-7">
              <div className="absolute -right-16 -top-16 size-64 rounded-full bg-[#C23E17]/25 blur-3xl" />
              <div className="relative">
                <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70">Stories · publicar e analisar</span>
                <h3 className="mt-8 max-w-lg font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Stories que você pode revisar, agendar e reaproveitar.</h3>
                <p className="mt-4 max-w-lg text-sm leading-7 text-white/65">Organize sequências, acompanhe as métricas disponíveis e duplique uma sequência para editar antes de publicar de novo.</p>
                <div className="mt-9 flex items-end gap-2" aria-label="Prévia ilustrativa de uma sequência de Stories">
                  {["bg-[#BBA18B]", "bg-[#E1C9B5]", "bg-[#6D625B]", "bg-[#D8B39A]"].map((color, index) => (
                    <div key={index} className={`relative h-[118px] w-[67px] overflow-hidden rounded-[14px] border border-white/15 ${color} sm:h-[145px] sm:w-[82px]`}>
                      <div className="absolute inset-x-2 top-2 h-1 rounded bg-white/70" />
                      <div className="absolute inset-x-2 bottom-3 space-y-1"><div className="h-1.5 w-4/5 rounded bg-white/75"/><div className="h-1 w-3/5 rounded bg-white/45"/></div>
                    </div>
                  ))}
                  <span className="ml-2 pb-2 text-[11px] text-white/45">Prévia ilustrativa</span>
                </div>
              </div>
              <Link href={appUrl("/stories")} className="relative mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#FF9870] transition hover:text-white">Explorar Stories <ArrowUpRight /></Link>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-[#22252A] p-7 sm:p-9 lg:col-span-5">
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70">Publicações · agendamento em lote</span>
              <h3 className="mt-8 font-display text-3xl font-bold tracking-[-0.04em]">Planeje o feed de uma vez.</h3>
              <p className="mt-4 text-sm leading-7 text-white/65">Monte carrosséis, importe várias publicações e confira a prévia da grade antes de seguir com o calendário.</p>
              <div className="mt-8 grid grid-cols-3 gap-2" aria-label="Prévia ilustrativa de uma grade de publicações">
                {["bg-[#C3B5A5]", "bg-[#786B61]", "bg-[#D8C8B8]", "bg-[#A59483]", "bg-[#E0D4C6]", "bg-[#9B7865]"].map((color, index) => <div key={index} className={`aspect-square rounded-xl ${color}`} />)}
              </div>
              <Link href={appUrl("/feed")} className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#FF9870] transition hover:text-white">Abrir o calendário <ArrowUpRight /></Link>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-[#22252A] p-7 sm:p-9 lg:col-span-5">
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70">Crescimento · visão do perfil</span>
              <h3 className="mt-7 font-display text-3xl font-bold tracking-[-0.04em]">Entenda os sinais por trás dos números.</h3>
              <p className="mt-3 text-sm leading-7 text-white/65">Compare desempenho por formato e período, acompanhe a evolução e use os resultados para planejar os próximos testes.</p>
              <div className="mt-7 flex h-28 items-end gap-2 rounded-2xl border border-white/10 bg-[#191B20] px-4 pb-4 pt-3" aria-label="Gráfico ilustrativo sem dados reais">
                {[32, 48, 39, 61, 52, 74, 64, 88, 72, 94, 81, 100].map((height, index) => <span key={index} className="flex-1 rounded-t-sm bg-[#F26B3A]" style={{ height: `${height}%`, opacity: 0.38 + index * 0.05 }} />)}
              </div>
              <p className="mt-2 text-right text-[10px] text-white/40">Ilustração · sem dados de conta</p>
              <Link href={appUrl("/growth")} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#FF9870] transition hover:text-white">Ver crescimento <ArrowUpRight /></Link>
            </article>

            <article className="rounded-[28px] border border-[#F26B3A]/30 bg-[#C23E17] p-7 sm:p-9 lg:col-span-7">
              <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/80">Campanhas · comentário para DM</span>
              <h3 className="mt-7 max-w-xl font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Respostas que começam onde o interesse aparece.</h3>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/80">Crie campanhas para posts e Reels, configure palavras-chave e acompanhe comentários, respostas e links em um fluxo só.</p>
              <div className="mt-8 flex flex-wrap gap-2 text-xs font-semibold">
                {["Palavras-chave", "Respostas privadas", "Links acompanhados", "Caixa de entrada"].map((label) => <span key={label} className="rounded-full border border-white/25 bg-white/10 px-3 py-2">{label}</span>)}
              </div>
              <Link href={appUrl("/campaigns")} className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-white underline decoration-white/40 underline-offset-4 transition hover:decoration-white">Conhecer campanhas <ArrowUpRight /></Link>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1320px] gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C23E17]">Segurança e controle</p><h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-5xl">Você decide o que conectar e o que publicar.</h2><p className="mt-5 max-w-lg text-base leading-7 text-[#626267]">A conexão usa as permissões autorizadas pela Meta. Revise campanhas e conteúdo no seu espaço de trabalho antes de colocar tudo em prática.</p><Link href="/meta-review" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#C23E17] hover:underline">Como funciona a integração <ArrowUpRight /></Link></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Autorização oficial", "Conecte sua conta pelo fluxo de login da Meta."],
            ["Sem senha do Instagram", "A autenticação acontece fora da Fisga."],
            ["Permissões visíveis", "Os recursos variam conforme as permissões aprovadas."],
            ["Ações acompanháveis", "Consulte campanhas, publicações e métricas no app."],
          ].map(([title, text]) => <article key={title} className="rounded-2xl border border-[#E2DDD1] bg-white p-5"><span className="text-[#C23E17]"><CheckIcon /></span><h3 className="mt-4 text-sm font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#68686C]">{text}</p></article>)}
        </div>
      </section>

      {showPricing && <PricingSection />}

      <section id="acesso" className="scroll-mt-24 px-5 pb-24 sm:px-8 sm:pb-32">
        <div className="mx-auto max-w-[1320px] overflow-hidden rounded-[32px] bg-[#E9E2D6] px-6 py-12 sm:px-12 sm:py-16 lg:px-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="max-w-[720px]"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A93212]">FISGA</p><h2 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">Seu próximo comentário merece uma resposta.</h2><p className="mt-5 max-w-xl text-base leading-7 text-[#55565A]">Entre na plataforma para conectar seu Instagram e conhecer as ferramentas de campanhas, publicação e análise.</p></div>
            <Link href={appUrl("/dashboard")} className="inline-flex min-h-14 items-center justify-center gap-3 self-start rounded-full bg-[#C23E17] px-7 text-base font-bold text-white transition hover:bg-[#A93212] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C23E17] lg:self-center">Acessar a Fisga <ArrowUpRight /></Link>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 border-t border-[#E2DDD1] bg-white/50">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.75fr_1.25fr]">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C23E17]">Dúvidas frequentes</p><h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-[-0.05em] sm:text-5xl">Antes de começar.</h2><p className="mt-5 max-w-sm text-sm leading-7 text-[#626267]">Veja o que você precisa para conectar sua conta e usar os recursos da plataforma.</p></div>
          <div className="divide-y divide-[#E2DDD1] border-y border-[#E2DDD1]">
            {faqs.map((faq, index) => <details key={faq.question} className="group py-5" open={index === 0}><summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-bold marker:hidden"><span>{faq.question}</span><span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border border-[#D8D2C8] text-lg font-normal text-[#C23E17] transition group-open:rotate-45">+</span></summary><p className="max-w-2xl pr-10 pt-4 text-sm leading-7 text-[#626267]">{faq.answer}</p></details>)}
          </div>
        </div>
      </section>

      <footer className="bg-[#16181D] text-white">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-8 px-5 py-9 sm:px-8 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-3" aria-label="Fisga, página inicial"><BrandLogo size={36} variant="negative" /></Link>
          <nav aria-label="Links do rodapé" className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/65">
            <Link href="/privacy" className="transition hover:text-white">Privacidade</Link>
            <Link href="/terms" className="transition hover:text-white">Termos de uso</Link>
            <Link href="/data-deletion" className="transition hover:text-white">Exclusão de dados</Link>
            <Link href="/meta-review" className="transition hover:text-white">Integração com a Meta</Link>
            <Link href="/login" className="transition hover:text-white">Entrar</Link>
          </nav>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} FISGA</p>
        </div>
      </footer>
    </main>
  );
}
