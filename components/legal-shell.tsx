import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { BrandLogo } from "@/components/brand-logo";

interface LegalShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacidade" },
  { href: "/terms", label: "Termos de uso" },
  { href: "/data-deletion", label: "Exclusão de dados" },
];

export default function LegalShell({
  title,
  description,
  children,
}: LegalShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo size={32} />
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-muted transition hover:text-foreground"
          >
            Entrar
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-14">
        <p className="text-sm font-semibold uppercase text-accent">
          Atualizado em {LEGAL.updatedAt}
        </p>
        <h1 className="mt-4 font-display text-4xl font-black text-foreground sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 text-base leading-8 text-muted">{description}</p>
        <div className="mt-10 space-y-10 text-sm leading-7 text-foreground">
          {children}
        </div>
      </article>

      <footer className="border-t border-border">
        <nav
          aria-label="Documentos legais"
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-5 py-6 text-sm text-muted"
        >
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-accent">{children}</ul>;
}
