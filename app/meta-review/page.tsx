import type { Metadata } from "next";
import LegalShell, { LegalSection } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Suporte para análise do app pela Meta - FISGA",
  description:
    "Informações sobre o fluxo oficial de respostas privadas no Instagram usado pela FISGA.",
};

export default function MetaReviewPage() {
  return (
    <LegalShell
      title="Suporte para análise do app pela Meta"
      description="A FISGA foi criada para contas profissionais do Instagram que desejam enviar respostas privadas após comentários com palavras-chave em publicações próprias ou Reels."
    >
      <LegalSection title="Fluxo de uso">
        <p>
          O responsável pela empresa entra com o e-mail, conecta uma conta
          profissional do Instagram pelo OAuth da Meta e cria uma campanha com
          palavra-chave para uma publicação ou Reel. Quando alguém comenta, a
          FISGA recebe o evento por webhook, evita duplicações, verifica os
          limites de envio e então envia uma resposta privada usando o ID do
          comentário.
        </p>
      </LegalSection>

      <LegalSection title="Conformidade">
        <p>
          O app usa as APIs oficiais da Meta, verifica assinaturas de webhook,
          criptografa tokens, não coleta senhas e não faz scraping. Para cada par
          de campanha e comentário correspondente, envia no máximo uma resposta
          privada.
        </p>
      </LegalSection>

      <LegalSection title="Notas para teste">
        <p>
          Para testar, use uma empresa de teste da Meta, conecte uma conta
          profissional do Instagram, crie uma palavra-chave como LINK e comente
          essa palavra na mídia selecionada. Em seguida, confirme que a resposta
          privada foi enviada e registrada uma única vez.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
