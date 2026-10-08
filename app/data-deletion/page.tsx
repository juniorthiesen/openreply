import type { Metadata } from "next";
import LegalShell, { LegalList, LegalSection } from "@/components/legal-shell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Exclusão de dados - ${LEGAL.brand}`,
  description: `Como remover o acesso da ${LEGAL.brand} ao seu Instagram e pedir a exclusão dos seus dados.`,
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Exclusão de dados"
      description={`Você pode remover o acesso da ${LEGAL.brand} à sua conta e pedir a exclusão dos seus dados a qualquer momento. Veja abaixo o caminho para cada caso.`}
    >
      <LegalSection title="1. Desconectar a conta no painel">
        <p>
          Entre na {LEGAL.brand}, abra <strong>Configurações</strong> e clique em{" "}
          <strong>Desconectar</strong> ao lado da conta do Instagram. Na hora, são
          apagados:
        </p>
        <LegalList>
          <li>o token de acesso da conta;</li>
          <li>as campanhas dessa conta e os registros de envio;</li>
          <li>os agendamentos, métricas e histórico de seguidores dessa conta.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. Remover o app pelo Instagram">
        <p>
          Também é possível revogar o acesso direto pelo Instagram, sem entrar na{" "}
          {LEGAL.brand}:
        </p>
        <LegalList>
          <li>
            No Instagram, abra <strong>Configurações → Apps e sites</strong> (ou
            acesse instagram.com/accounts/manage_access).
          </li>
          <li>
            Em <strong>Ativos</strong>, selecione a {LEGAL.brand} e toque em{" "}
            <strong>Remover</strong>.
          </li>
        </LegalList>
        <p>
          A partir disso, a {LEGAL.brand} não consegue mais ler nem enviar nada
          pela conta. Para apagar também os dados que já estavam salvos, siga o
          passo 3.
        </p>
      </LegalSection>

      <LegalSection title="3. Pedir a exclusão completa">
        <p>
          Para excluir todo o espaço de trabalho (conta de acesso, membros,
          campanhas, registros, arquivos enviados e diagnósticos), envie um
          e-mail para{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-accent underline">
            {LEGAL.contactEmail}
          </a>{" "}
          a partir do e-mail usado para entrar, informando:
        </p>
        <LegalList>
          <li>o nome do espaço de trabalho;</li>
          <li>o @ das contas do Instagram conectadas.</li>
        </LegalList>
        <p>
          Se você comentou ou enviou mensagem para uma empresa que usa a{" "}
          {LEGAL.brand} e quer que seus dados sejam apagados, envie o seu @ do
          Instagram para o mesmo e-mail.
        </p>
      </LegalSection>

      <LegalSection title="4. Prazo e confirmação">
        <p>
          Podemos pedir a confirmação de que você controla o e-mail ou a conta
          antes de excluir. Os pedidos são concluídos em até 30 dias, e você
          recebe uma confirmação por e-mail. Só mantemos o que a lei obrigar a
          guardar, pelo prazo que ela exigir.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
