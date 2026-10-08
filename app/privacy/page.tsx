import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { LegalList, LegalSection } from "@/components/legal-shell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Política de privacidade - ${LEGAL.brand}`,
  description: `Quais dados a ${LEGAL.brand} coleta das contas do Instagram e do Facebook conectadas, para que usa, com quem compartilha e como excluir.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Política de privacidade"
      description={`A ${LEGAL.brand} ajuda empresas a responder comentários e mensagens, agendar publicações e acompanhar resultados de contas profissionais do Instagram, sempre pelas APIs oficiais da Meta. Esta política explica quais dados tratamos, por quê e como você controla esses dados.`}
    >
      <LegalSection title="1. Quem somos">
        <p>
          O serviço {LEGAL.brand} é operado por {LEGAL.legalName}, inscrita no{" "}
          {LEGAL.document}, que atua como controladora dos dados das contas dos
          usuários da plataforma, nos termos da Lei Geral de Proteção de Dados
          (Lei nº 13.709/2018, LGPD).
        </p>
        <p>
          Em relação aos dados de pessoas que comentam ou enviam mensagens para
          uma conta conectada, a {LEGAL.brand} atua como operadora: trata esses
          dados em nome da empresa dona da conta, que é a controladora e define
          as campanhas e as mensagens enviadas.
        </p>
      </LegalSection>

      <LegalSection title="2. Dados que tratamos">
        <p className="font-semibold">Dados da sua conta na {LEGAL.brand}</p>
        <LegalList>
          <li>E-mail usado para entrar (o acesso é feito por link enviado ao e-mail, sem senha).</li>
          <li>Nome e dados do espaço de trabalho, membros convidados e suas funções.</li>
          <li>Configurações de campanhas, mensagens, links e agendamentos que você cria.</li>
          <li>Arquivos de imagem e vídeo que você envia para publicar.</li>
        </LegalList>

        <p className="font-semibold">Dados recebidos da Meta, conforme as permissões que você autoriza</p>
        <LegalList>
          <li>
            <strong>Perfil da conta profissional</strong> (instagram_business_basic):
            ID, nome de usuário, nome, foto, número de seguidores e lista de
            publicações e Reels, para conectar a conta e escolher em qual mídia a
            campanha vai atuar.
          </li>
          <li>
            <strong>Comentários</strong> (instagram_business_manage_comments):
            texto do comentário, ID e nome de usuário de quem comentou, para
            identificar palavras-chave e responder publicamente quando a campanha
            estiver configurada para isso.
          </li>
          <li>
            <strong>Mensagens</strong> (instagram_business_manage_messages): ID e
            nome de usuário de quem conversa com a conta, conteúdo das mensagens e
            anexos, para enviar a resposta privada da campanha e exibir as
            conversas na caixa de entrada da {LEGAL.brand}.
          </li>
          <li>
            <strong>Publicação de conteúdo</strong>
            (instagram_business_content_publish): usada apenas para publicar as
            fotos, carrosséis, Reels e Stories que você agenda ou manda publicar.
          </li>
          <li>
            <strong>Métricas</strong> (instagram_business_manage_insights): alcance,
            visualizações, interações e evolução de seguidores, para os relatórios
            de desempenho.
          </li>
          <li>
            <strong>Páginas do Facebook</strong> (opcional): nome, ID e token da
            Página que você escolher conectar, para recursos que dependem da
            Página vinculada ao Instagram.
          </li>
        </LegalList>

        <p className="font-semibold">Dados técnicos</p>
        <LegalList>
          <li>
            Cliques nos links enviados pelas campanhas: data, navegador e um
            identificador cifrado (hash) do destinatário ou do endereço IP. Não
            guardamos o endereço IP em texto.
          </li>
          <li>Registros de entrega, eventos de webhook e diagnósticos de falhas.</li>
          <li>
            Cookies essenciais de sessão e de preferência de idioma. Não usamos
            cookies de publicidade.
          </li>
        </LegalList>
        <p>
          Não pedimos senhas do Instagram ou do Facebook, não coletamos dados por
          scraping e não automatizamos a navegação de nenhuma conta.
        </p>
      </LegalSection>

      <LegalSection title="3. Para que usamos os dados">
        <LegalList>
          <li>Autenticar você e manter o seu espaço de trabalho.</li>
          <li>
            Executar as campanhas que você configura: identificar palavras-chave,
            enviar a resposta privada, verificar se a pessoa segue a conta quando
            essa regra estiver ativa e evitar envios duplicados.
          </li>
          <li>Publicar o conteúdo que você agendar.</li>
          <li>Exibir conversas, registros, métricas e relatórios no painel.</li>
          <li>Investigar falhas, prevenir abuso e proteger o serviço.</li>
        </LegalList>
        <p>
          Os dados recebidos da Meta são usados apenas para prestar esses
          serviços à conta que os autorizou. Não vendemos dados, não os usamos
          para publicidade e não os compartilhamos com corretores de dados.
        </p>
      </LegalSection>

      <LegalSection title="4. Bases legais">
        <LegalList>
          <li>
            <strong>Execução de contrato</strong> (art. 7º, V, da LGPD): para
            prestar o serviço contratado pelo usuário.
          </li>
          <li>
            <strong>Legítimo interesse</strong> (art. 7º, IX): para segurança,
            prevenção a fraudes e melhoria do serviço, sempre respeitando os
            direitos dos titulares.
          </li>
          <li>
            <strong>Cumprimento de obrigação legal</strong> (art. 7º, II): quando a
            lei exigir a guarda de registros.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. Com quem compartilhamos">
        <p>Compartilhamos dados apenas com quem é necessário para o serviço funcionar:</p>
        <LegalList>
          <li>
            <strong>Meta Platforms</strong> (Instagram e Facebook), para enviar
            mensagens, respostas e publicações pelas APIs oficiais.
          </li>
          <li>
            <strong>Provedores de infraestrutura</strong>: hospedagem do
            servidor, banco de dados e filas de processamento.
          </li>
          <li>
            <strong>Provedor de e-mail</strong>, para enviar o link de acesso e
            convites.
          </li>
          <li>Autoridades públicas, quando houver obrigação legal ou ordem judicial.</li>
        </LegalList>
        <p>
          Alguns desses provedores podem armazenar dados fora do Brasil. Nesses
          casos, exigimos garantias de proteção compatíveis com a LGPD.
        </p>
      </LegalSection>

      <LegalSection title="6. Por quanto tempo guardamos">
        <LegalList>
          <li>
            Tokens de acesso da Meta: enquanto a conta estiver conectada. São
            guardados criptografados e apagados quando você desconecta a conta.
          </li>
          <li>
            Campanhas, registros de envio, conversas exibidas e métricas de uma
            conta do Instagram: apagados junto com a conta, quando você a
            desconecta.
          </li>
          <li>
            Demais dados do espaço de trabalho: enquanto você usar o serviço, e
            excluídos em até 30 dias após o pedido de exclusão, salvo quando a lei
            exigir guarda por mais tempo.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="7. Segurança">
        <p>
          Tokens de acesso são criptografados (AES-256-GCM) antes de serem
          salvos, as assinaturas dos webhooks da Meta são verificadas e o acesso
          ao painel é restrito aos membros de cada espaço de trabalho, conforme a
          função de cada um. Nenhum sistema é totalmente imune a incidentes; se
          ocorrer um incidente relevante, comunicaremos os afetados e a ANPD,
          como exige a LGPD.
        </p>
      </LegalSection>

      <LegalSection title="8. Seus direitos">
        <p>
          Pela LGPD, você pode pedir a confirmação do tratamento, o acesso, a
          correção, a anonimização, a portabilidade e a exclusão dos seus dados,
          além de informações sobre compartilhamento e a revogação do
          consentimento. Pessoas que interagiram com uma conta conectada podem
          fazer o pedido à empresa dona da conta ou diretamente a nós, e
          ajudaremos a empresa a atendê-lo.
        </p>
        <p>
          Para excluir dados ou remover o acesso da {LEGAL.brand} à sua conta,
          veja a página de{" "}
          <Link href="/data-deletion" className="font-medium text-accent underline">
            exclusão de dados
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="9. Crianças e adolescentes">
        <p>
          O serviço é destinado a empresas e não deve ser usado por menores de 18
          anos.
        </p>
      </LegalSection>

      <LegalSection title="10. Alterações">
        <p>
          Podemos atualizar esta política. A data no topo indica a versão atual e,
          em mudanças relevantes, avisaremos os usuários pelo painel ou por
          e-mail.
        </p>
      </LegalSection>

      <LegalSection title="11. Contato">
        <p>
          Dúvidas e pedidos sobre privacidade:{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-accent underline">
            {LEGAL.contactEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
