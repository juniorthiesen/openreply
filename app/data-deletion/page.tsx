import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Exclusão de dados - FISGA",
  description:
    "Como desconectar o Instagram e solicitar a exclusão de dados da conta, do espaço de trabalho ou das campanhas na FISGA.",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Exclusão de dados"
      description="Informações para desconectar o Instagram e solicitar a remoção dos dados da conta, do espaço de trabalho e das campanhas da FISGA."
      updatedAt="May 24, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Desconectar o Instagram</h2>
        <p className="mt-3">
          Sign in, open Settings, and select Disconnect. This removes the stored
          Instagram connection token and stops campaigns from sending private
          replies for that workspace.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Excluir dados do espaço de trabalho</h2>
        <p className="mt-3">
          To delete workspace, campaign, log, webhook, billing reference, and
          operational diagnostic data, contact support from the email address
          used to sign in. Include the workspace name and the Instagram username
          connected to the workspace.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Verificação</h2>
        <p className="mt-3">
          We may ask you to verify control of the email address or connected
          business account before deleting data. Deletion requests are processed
          as quickly as practical unless retention is required for legal,
          billing, fraud prevention, or security reasons.
        </p>
      </section>
    </LegalShell>
  );
}
