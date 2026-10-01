import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Política de privacidade - FISGA",
  description:
    "Como a FISGA trata dados da conta do Instagram, eventos de webhook, dados de cobrança e informações de campanhas.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Política de privacidade"
      description="A FISGA ajuda empresas a enviar respostas privadas autorizadas pela Meta quando alguém comenta em publicações ou Reels conectados."
      updatedAt="May 24, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Dados que coletamos</h2>
        <p className="mt-3">
          Coletamos endereços de e-mail para autenticação, metadados do espaço de
          trabalho e de cobrança, identificadores das contas do Instagram
          conectadas, tokens de acesso criptografados, configurações de campanha,
          dados de webhook, comentários necessários para processar campanhas,
          registros de entrega e diagnósticos operacionais.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Como usamos os dados</h2>
        <p className="mt-3">
          Usamos esses dados para autenticar usuários, conectar contas do
          Instagram, identificar palavras-chave em comentários, enviar respostas
          privadas pelas APIs oficiais da Meta, evitar envios duplicados,
          investigar falhas e proteger o serviço.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Dados do Instagram e da Meta</h2>
        <p className="mt-3">
          A FISGA não pede senhas do Instagram, não coleta dados por scraping e
          não automatiza a navegação pelo navegador. Os tokens do Instagram são
          criptografados quando armazenados e usados apenas para realizar ações
          autorizadas pela conta comercial conectada.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Prestadores de serviço</h2>
        <p className="mt-3">
          O serviço pode usar provedores de hospedagem, banco de dados, filas
          Redis, e-mail e monitoramento, como Vercel, Railway, PostgreSQL, Redis
          e Resend. Esses provedores processam dados apenas quando necessário
          para operar o serviço.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Retenção e exclusão</h2>
        <p className="mt-3">
          Você pode desconectar o Instagram nas configurações. Isso remove a
          conexão armazenada e interrompe as campanhas. Para solicitar a
          exclusão da conta ou de outros dados, consulte a página de exclusão de
          dados no rodapé.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Contato</h2>
        <p className="mt-3">
          Para dúvidas sobre privacidade, use o e-mail de suporte informado pela
          equipe responsável pelo seu espaço de trabalho.
        </p>
      </section>
    </LegalShell>
  );
}
