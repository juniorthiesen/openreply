# Análise do app pela Meta (App Review) — FISGA

Guia para pedir **Advanced Access** e permitir que contas de clientes se conectem
sem convite de testador. Enquanto a análise não for aprovada, só contas com função
no app (administrador, desenvolvedor ou Instagram Tester) conseguem conectar — é o
erro "Esta conta ainda não tem acesso ao app" no painel.

Os textos de envio estão em **inglês**, que é o idioma que os revisores leem.
O restante está em português.

---

## 1. Antes de enviar (checklist)

- [ ] **Verificação da empresa** no Business Manager (Configurações do negócio →
      Central de segurança → Verificação). A Meta pede CNPJ e um documento que comprove
      a empresa (cartão CNPJ, contrato social ou conta de luz/telefone em nome da
      empresa). Sem isso o Advanced Access não é liberado.
- [ ] App vinculado ao portfólio de negócios verificado.
- [ ] **URLs no painel do app** (Configurações → Básico):
  - Política de privacidade: `https://SEU-DOMINIO/privacy`
  - Termos de serviço: `https://SEU-DOMINIO/terms`
  - Exclusão de dados (instruções): `https://SEU-DOMINIO/data-deletion`
- [ ] Dados da empresa preenchidos em [`lib/legal.ts`](../lib/legal.ts) (razão social,
      CNPJ, e-mail de contato, cidade) e publicados — as três páginas acima leem de lá.
- [ ] Ícone do app (1024×1024), categoria ("Business and Pages" ou "Messaging") e
      e-mail de contato do app preenchidos.
- [ ] **Uso de dados** (Data Use Checkup) respondido no painel.
- [ ] **Acesso para os revisores** (ver seção 5): os revisores precisam entrar no
      painel da FISGA. O login atual é por link no e-mail, que eles não recebem.
- [ ] Uma conta profissional do Instagram de teste, com pelo menos um post ou Reel,
      e uma segunda conta comum para comentar e mandar DM nos vídeos.

---

## 2. Permissões a pedir

### Instagram API com login do Instagram (produto "Instagram")

| Permissão | Para quê na FISGA |
|---|---|
| `instagram_business_basic` | Identificar a conta conectada, listar posts e Reels para escolher a campanha, nome de usuário de quem interage, verificação de "segue a conta" |
| `instagram_business_manage_comments` | Receber comentários por webhook, achar a palavra-chave e responder publicamente |
| `instagram_business_manage_messages` | Resposta privada ao comentário, gatilho por palavra-chave na DM, botões, caixa de entrada |
| `instagram_business_content_publish` | Publicar fotos, carrosséis e Reels agendados |
| `instagram_business_manage_insights` | Métricas dos posts, Reels de teste e evolução de seguidores |

O recurso **Human Agent** só é necessário para responder pela caixa de entrada fora
da janela de 24 horas — hoje a FISGA bloqueia isso, então **não peça**.

### Facebook Login for Business (produto "Facebook Login for Business")

Usado para conectar a Página do Facebook e publicar **Stories**. Peça as permissões
que estão na configuração cujo ID vai em `FACEBOOK_LOGIN_CONFIG_ID`. Normalmente:
`pages_show_list`, `pages_read_engagement`, `business_management`,
`instagram_basic`, `instagram_content_publish`.

> Se a publicação de Stories não for essencial no lançamento, deixe o Facebook Login
> para uma **segunda análise**. Menos permissões = análise mais rápida e menos
> chance de recusa.

---

## 3. Textos de justificativa (cole no formulário)

Troque `SEU-DOMINIO` pelo domínio real. Cada texto responde às três perguntas que o
revisor faz: *o que o app faz com a permissão, como isso aparece para o usuário e
por que é necessária*.

**instagram_business_basic**

> FISGA is a tool for Instagram professional accounts. After the account owner logs
> in with Instagram, we use instagram_business_basic to read the account's ID,
> username and profile picture, to link it to the owner's workspace, and to list the
> account's own posts and reels so the owner can choose which post a comment
> campaign applies to. We also read the username of people who comment or message
> the account, so the owner sees who received each reply, and whether they follow
> the account when the owner enables the "followers only" option. We never access
> accounts other than the one that authorized the app.

**instagram_business_manage_comments**

> The account owner creates a campaign: a post or reel of their own, one or more
> keywords, and a message. We subscribe to the comments webhook, and when someone
> comments one of the keywords on that post, we match it and, if the owner enabled
> it, publish a short public reply under the comment (for example "Sent you a DM!").
> We only read and reply to comments on the connected account's own media.

**instagram_business_manage_messages**

> When a comment matches a campaign keyword, we send the commenter one private reply
> (the Instagram comment-to-DM flow) with the content the owner configured, usually
> the product link the person asked for. Owners can also trigger the same reply when
> someone sends the keyword by DM. Replies can carry buttons, and a button tap
> (postback) delivers the next message. Our inbox shows the account's conversations
> so the owner can follow up manually inside the 24-hour messaging window. We send
> at most one private reply per comment, respect Meta's rate limits and never
> message people who did not interact with the account first.

**instagram_business_content_publish**

> Owners schedule photos, carousels and reels in FISGA's content calendar. At the
> scheduled time we create the media container and publish it to the owner's
> account. We only publish content the owner uploaded and scheduled, and the owner
> can edit or cancel any scheduled post before it is published.

**instagram_business_manage_insights**

> We read insights for the connected account's own media and profile (reach, views,
> interactions, follower count) to show the owner a performance dashboard, compare
> trial reels with regular reels, and chart follower growth over time. The data is
> shown only to members of the owner's workspace.

---

## 4. Roteiro dos vídeos (screencasts)

Regras da Meta que mais causam recusa:

- **Um vídeo por permissão** (ou um vídeo com capítulos claramente marcados). O
  revisor precisa ver *aquela* permissão produzindo um resultado real.
- **Interface em português → legendas em inglês** explicando cada clique. Sem isso
  o vídeo costuma ser recusado. Dica: grave e legende no CapCut.
- Mostre a **tela de consentimento da Meta** com as permissões sendo aprovadas.
- Contas reais, app publicado (modo Live), sem cortes no meio da ação principal.
- Resolução mínima de 1080p, 1–3 minutos por vídeo.

### Vídeo A — basic + manage_comments + manage_messages (comentário → DM)

1. Abrir `https://SEU-DOMINIO/login` e entrar.
   *Legenda: "Business owner signs in to FISGA."*
2. Configurações → **Conectar Instagram** → tela da Meta com as permissões → aprovar.
   *Legenda: "The owner grants instagram_business_basic, manage_comments and
   manage_messages."*
3. Mostrar a conta conectada (usa `instagram_business_basic`).
4. Campanhas → **Nova campanha** → escolher um Reel da lista
   (`instagram_business_basic`) → palavra-chave `LINK` → mensagem com link →
   ativar resposta pública → salvar.
5. No celular, com a **segunda conta**, comentar `LINK` no Reel.
6. Mostrar a resposta pública aparecendo sob o comentário
   (`instagram_business_manage_comments`).
7. Mostrar a DM chegando na segunda conta, com o botão; tocar no botão e mostrar a
   mensagem seguinte (`instagram_business_manage_messages`).
8. De volta à FISGA: **Registros de DM** com a linha "Enviada" e o @ da pessoa.
9. **Caixa de entrada** mostrando a conversa.

### Vídeo B — content_publish

1. Painel → **Agendar** → enviar um vídeo → escrever legenda → escolher horário
   próximo (ou "Publicar agora").
2. Mostrar o post na fila e depois com status "Publicado".
3. Abrir o perfil no Instagram e mostrar o Reel publicado.

### Vídeo C — manage_insights

1. Abrir **Visão geral** e **Crescimento** com as métricas da conta.
2. Abrir um post e mostrar alcance/visualizações/interações.
3. *Legenda: "Insights are shown only to the account owner's workspace."*

---

## 5. Acesso dos revisores ao painel

O login da FISGA é por **link mágico no e-mail**, e o revisor não tem acesso à sua
caixa de e-mail. Opções, da mais simples para a mais robusta:

1. **Login de revisão com senha** (recomendado): um acesso fixo, ativado só por
   variáveis de ambiente durante a análise, preso a um espaço de trabalho de teste.
   *Ainda não implementado — precisa ser feito antes do envio.*
2. Informar nas instruções de teste que o revisor deve assistir aos vídeos, porque o
   acesso exige e-mail. A Meta aceita às vezes, mas aumenta a chance de pedirem
   mais informações.

Texto para o campo "Testing instructions":

> 1. Go to https://SEU-DOMINIO/login and sign in with the reviewer credentials
>    below.
> 2. The workspace already has the test Instagram account connected and a campaign
>    with the keyword LINK on the latest reel.
> 3. Comment "LINK" on that reel from any Instagram account: you will receive a
>    public reply and a private message with a link.
> 4. Open "Registros de DM" (DM logs) to see the delivery and "Caixa de entrada"
>    (Inbox) to see the conversation.
> The interface is in Brazilian Portuguese; the screencasts have English captions.

---

## 6. Depois da aprovação

- Contas novas conectam sem convite; o aviso de testador some sozinho.
- Mantenha as páginas legais no ar e o e-mail de contato funcionando: a Meta faz
  verificações periódicas (Data Use Checkup anual).
- Toda permissão nova (ex.: Facebook Login para Stories) exige uma nova análise.
