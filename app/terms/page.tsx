import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { LegalList, LegalSection } from "@/components/legal-shell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Termos de uso - ${LEGAL.brand}`,
  description: `Condições para usar as ferramentas de campanhas, mensagens e publicação para Instagram da ${LEGAL.brand}.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Termos de uso"
      description={`Estes termos definem as condições para usar a ${LEGAL.brand}. Ao criar uma conta ou conectar um perfil do Instagram, você concorda com eles e com a nossa política de privacidade.`}
    >
      <LegalSection title="1. O serviço">
        <p>
          A {LEGAL.brand}, operada por {LEGAL.legalName} ({LEGAL.document}),
          oferece ferramentas para contas profissionais do Instagram: respostas
          automáticas a comentários e mensagens, caixa de entrada, agendamento de
          publicações e relatórios. Tudo funciona pelas APIs oficiais da Meta.
        </p>
      </LegalSection>

      <LegalSection title="2. Contas que você pode conectar">
        <p>
          Você só pode conectar contas profissionais do Instagram e Páginas do
          Facebook que sejam suas ou que você esteja autorizado a gerenciar. Ao
          conectar, você autoriza a {LEGAL.brand} a agir nessas contas dentro das
          permissões aprovadas na tela da Meta.
        </p>
      </LegalSection>

      <LegalSection title="3. Suas responsabilidades">
        <LegalList>
          <li>
            Você é responsável pelas campanhas, palavras-chave, mensagens, links e
            publicações que configurar, e por manter as informações da sua conta
            corretas.
          </li>
          <li>
            Você deve seguir os Termos da Plataforma Meta, as Diretrizes da
            Comunidade e as políticas de mensagens do Instagram, o Código de
            Defesa do Consumidor e a LGPD.
          </li>
          <li>
            Como controladora dos dados de quem interage com a sua conta, você
            deve informar esse tratamento na sua própria política de privacidade e
            atender os pedidos dessas pessoas.
          </li>
          <li>Mantenha o acesso ao seu e-mail seguro: ele é a chave da sua conta.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Usos proibidos">
        <p>Não é permitido usar a {LEGAL.brand} para:</p>
        <LegalList>
          <li>enviar spam, mensagens não solicitadas em massa ou conteúdo enganoso;</li>
          <li>divulgar produtos ilegais, golpes ou conteúdo que viole direitos de terceiros;</li>
          <li>contornar limites, regras ou mecanismos de segurança da Meta;</li>
          <li>coletar dados de pessoas para fins diferentes do atendimento da sua conta.</li>
        </LegalList>
        <p>
          Podemos pausar campanhas ou suspender contas que coloquem em risco os
          usuários, o serviço ou a conformidade com as regras da Meta, avisando
          sempre que possível.
        </p>
      </LegalSection>

      <LegalSection title="5. Disponibilidade e limites da Meta">
        <p>
          O serviço depende da Meta e de provedores de hospedagem, banco de dados
          e e-mail. A Meta pode limitar envios, alterar APIs ou revogar
          permissões a qualquer momento, o que pode afetar recursos da{" "}
          {LEGAL.brand}. Trabalhamos para manter o serviço estável, mas não
          garantimos funcionamento ininterrupto.
        </p>
      </LegalSection>

      <LegalSection title="6. Responsabilidade">
        <p>
          A {LEGAL.brand} não se responsabiliza por bloqueios, restrições ou
          penalidades aplicadas pela Meta por uso em desacordo com as regras dela,
          nem pelo conteúdo das mensagens e publicações configuradas pelos
          usuários. Nos limites da lei, a responsabilidade da {LEGAL.brand} fica
          restrita aos valores pagos pelo serviço nos 12 meses anteriores ao
          fato.
        </p>
      </LegalSection>

      <LegalSection title="7. Encerramento">
        <p>
          Você pode desconectar contas e encerrar o uso a qualquer momento. A
          exclusão dos dados segue a{" "}
          <Link href="/data-deletion" className="font-medium text-accent underline">
            página de exclusão de dados
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="8. Alterações e foro">
        <p>
          Podemos atualizar estes termos e avisaremos sobre mudanças relevantes.
          Estes termos seguem a lei brasileira, e fica eleito o foro de{" "}
          {LEGAL.city} para resolver eventuais disputas.
        </p>
        <p>
          Contato:{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-accent underline">
            {LEGAL.contactEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
