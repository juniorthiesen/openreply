import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Termos de uso - FISGA",
  description:
    "Termos para uso das ferramentas de campanhas e conteúdo para Instagram da FISGA.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Termos de uso"
      description="Estes termos definem as condições de uso das ferramentas de campanhas e conteúdo para Instagram da FISGA."
      updatedAt="May 24, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Uso autorizado</h2>
        <p className="mt-3">
          Você pode usar a FISGA apenas com contas profissionais do Instagram
          que possui ou está autorizado a gerenciar. Você é responsável pelas
          campanhas, palavras-chave, links e mensagens que configurar.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Regras da plataforma</h2>
        <p className="mt-3">
          Você concorda em seguir os termos da plataforma Meta, as políticas do
          Instagram, as regras de mensagens aplicáveis e as leis de privacidade,
          publicidade e combate a spam. A FISGA pode limitar, pausar ou desativar
          campanhas que criem riscos de conformidade, abuso, segurança ou
          entrega.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Disponibilidade</h2>
        <p className="mt-3">
          A FISGA depende de serviços de terceiros, incluindo Meta, provedores de
          e-mail, hospedagem, banco de dados e filas. Trabalhamos para manter o
          serviço confiável, mas não garantimos disponibilidade ininterrupta.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Serviços e ferramentas</h2>
        <p className="mt-3">
          O repositório público é licenciado sob MIT. A infraestrutura hospedada,
          o suporte gerenciado, os fluxos para agências, as análises, os
          relatórios e outros recursos pagos podem ser fornecidos separadamente
          do núcleo de código aberto.
        </p>
      </section>
    </LegalShell>
  );
}
