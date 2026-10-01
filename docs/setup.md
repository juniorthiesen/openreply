# Setup

Everything you need to get OpenReply running end to end, in one place: hosting, the domain, environment variables, and the Meta app. Read it in order. The code deploys in minutes. The Meta side is the part that takes real time, so budget an afternoon the first time.

If you would rather have an AI assistant drive most of this, skip to [Set it up with an AI assistant](#set-it-up-with-an-ai-assistant) at the end and come back here when it asks for specifics.

## How it is built

OpenReply is two processes and two datastores.

- Web app and API: Next.js. Serves the dashboard, the OAuth callback, and the incoming webhook. Runs well on Vercel.
- Worker: a long-running Node process (`npm run worker`) that consumes the send queue and runs the polling reconciler. It cannot run on Vercel, because serverless functions are short-lived and a queue consumer has to stay up. Railway, Render, Fly, or any always-on box works.
- PostgreSQL: campaigns, logs, accounts, sessions.
- Redis: the BullMQ send queue and the per-account rate limiter.

The web app and the worker must share the same `DATABASE_URL`, the same `REDIS_URL`, and the same `ENCRYPTION_KEY`. The web app writes an encrypted Instagram token; the worker decrypts it to send. Different keys mean every send fails to decrypt.

## What you need first

- A Facebook account. Meta developer registration is built on it. There is no Instagram-only path.
- An Instagram Business or Creator account. A personal account cannot be connected. Switch it in the Instagram app under Settings, Account type, if needed.
- A [Resend](https://resend.com) account for login emails, with a verified sender domain. Login is email magic links only, so without this nobody can sign in. If you already run your own mail server, you can point `EMAIL_SERVER` at it instead and skip Resend entirely — see the [environment variables](#environment-variables) table.
- Somewhere to host. The recommended setup, used throughout this guide, is Vercel for the web app and Railway for the worker plus Postgres and Redis. Both have free tiers that are enough to run this for a single account.

## Hosting and your domain

You do not need to buy a domain. Deploying the web app to Vercel gives you a free public URL like `your-app.vercel.app`, and that URL is what everything else points at: `NEXTAUTH_URL`, the Meta OAuth redirect, and the Meta webhook callback all use it. If you want a custom domain later you can add one, but it is optional and you can launch without it.

Recommended split:

- Web app: Vercel. You get `your-app.vercel.app` for free on deploy.
- Worker, Postgres, Redis: Railway.

Do Railway first, because Vercel needs the database URLs from it.

### Step 1: Railway (Postgres, Redis, worker)

1. Create a Railway account and a New Project.
2. In the project, click New, then Database, then Add PostgreSQL.
3. Click New, then Database, then Add Redis.
4. Add the worker: click New, then GitHub Repo, and select your fork of this repo. Railway detects the Node app.
5. Open the worker service's Settings and set the Build Command and Start Command:
   ```
   Build Command:  npm run db:generate
   Start Command:  npm run worker
   ```
   The worker only needs the generated Prisma client, not `next build`. Do not leave the build as the default `npm run build`: it runs `next build` needlessly, and any build step that reaches the database (like `prisma migrate deploy`) fails here, because the worker cannot connect to Postgres at build time. Migrations are applied by the web app's `vercel-build` (Step 3) and by the manual `db:migrate` below, never by the worker.
6. Open the worker service's Variables and add all the environment variables from the [table below](#environment-variables). For the worker, use Railway's internal database and Redis hostnames (they look like `postgres.railway.internal` and `redis.railway.internal`); inside Railway's network they are faster and free of egress. `NEXTAUTH_URL` is your Vercel domain. `ENCRYPTION_KEY` must be the exact same value you will use on Vercel.

Getting the connection URLs. Open the Postgres service, then its Variables or Connect tab. You will see two URLs:

| Variable | Host | Use it for |
| --- | --- | --- |
| `DATABASE_URL` | `postgres.railway.internal` | the Railway worker only |
| `DATABASE_PUBLIC_URL` | `*.proxy.rlwy.net` | Vercel, and running migrations from your machine |

Redis is the same: `REDIS_URL` (internal) for the worker, `REDIS_PUBLIC_URL` (public proxy) for Vercel.

Vercel runs outside Railway's private network, so if you give Vercel an internal `*.railway.internal` URL it will hang and time out. Always give Vercel the public URLs.

### Step 2: Migrate the production database

Run once from your machine, using the public Postgres URL:

```bash
DATABASE_URL="postgresql://...proxy.rlwy.net.../railway" npm run db:migrate
```

### Step 3: Vercel (web app, and your domain)

1. Create a Vercel account and Add New Project, importing your fork. It auto-detects Next.js.
2. Under the project's Settings, then Environment Variables, add every variable from the [table below](#environment-variables). Use these values:
   - `NEXTAUTH_URL`: your Vercel domain, for example `https://your-app.vercel.app`. This is the free domain Vercel assigns on deploy.
   - `DATABASE_URL` and `REDIS_URL`: the public Railway URLs (`DATABASE_PUBLIC_URL` and `REDIS_PUBLIC_URL` from Railway).
   - `ENCRYPTION_KEY`: the exact same value as on the worker.
3. Deploy. The build runs `prisma generate` before `next build`, so the Prisma client is generated even though it is gitignored.
4. The daily token-refresh cron is wired up in `vercel.json`.

Note on crons: Vercel's free plan allows each cron to run at most once per day. The repo's crons are set to daily for that reason. The comment polling reconciler does not use a Vercel cron; it runs inside the Railway worker on its own interval, so the free plan is not a constraint there.

Optional custom domain: if you want `openreply.yoursite.com` instead of the Vercel URL, add it in Vercel under Domains and make it primary. Then update `NEXTAUTH_URL` and the two Meta URLs (Step 7 and Step 8 below) to the new domain, and update the worker's `NEXTAUTH_URL` too, or tracked links in DMs will point at the old domain.

## Implantação com Docker, Traefik e Cloudflare (produção)

Esta é a alternativa usada na instância auto-hospedada do projeto. Ela mantém a aplicação web, o worker, PostgreSQL e Redis no mesmo servidor Docker e usa Traefik para HTTPS. O domínio público configurado para esta instância é `https://reply.iafotos.com.br`.

> Não salve no Git o arquivo `.env`, chaves de API, tokens do Instagram, credenciais SSH ou endereços privados do servidor. Use apenas os nomes das variáveis e valores de exemplo neste documento.

### 1. Preparar o servidor

No servidor com Docker e Docker Compose, crie um diretório para o projeto e clone o repositório:

```bash
mkdir -p /opt/openreply
git clone https://github.com/diwenne/openreply /opt/openreply
cd /opt/openreply
```

Copie `.env.example` para `.env` e preencha as variáveis da seção [Environment variables](#environment-variables). Gere valores novos para todos os segredos; não reutilize valores que tenham sido enviados por chat.

O `DATABASE_URL` e o `REDIS_URL` devem apontar para os nomes dos serviços da rede interna do Compose, por exemplo:

```env
DATABASE_URL=postgresql://postgres:UMA_SENHA_FORTE@postgres:5432/openreply
REDIS_URL=redis://redis:6379
NEXTAUTH_URL=https://reply.iafotos.com.br
MEDIA_STORAGE_DIR=/data/media
```

Crie um volume persistente para os arquivos de imagem e vídeo:

```bash
docker volume create openreply-media
```

### 2. Adicionar web, worker e Traefik

O `docker-compose.yml` do projeto inicia PostgreSQL e Redis. Crie um arquivo adicional chamado `docker-compose.server.yml` para a aplicação web, o worker e a rota HTTPS. Ajuste o domínio e o nome da rede do Traefik se a sua infraestrutura usar nomes diferentes.

```yaml
services:
  web:
    build: .
    image: openreply:latest
    env_file: .env
    environment:
      NODE_ENV: production
    volumes:
      - openreply-media:/data/media
    command: sh -c "npx prisma migrate deploy && npm run start"
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.openreply.rule=Host(`reply.iafotos.com.br`)
      - traefik.http.routers.openreply.entrypoints=websecure
      - traefik.http.routers.openreply.tls=true
      - traefik.http.services.openreply.loadbalancer.server.port=3000
    networks: [default, traefik]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  worker:
    image: openreply:latest
    env_file: .env
    volumes:
      - openreply-media:/data/media
    command: sh -c "npx prisma migrate deploy && npm run worker"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

networks:
  traefik:
    external: true

volumes:
  openreply-media:
    external: true
    name: openreply-media
```

O mesmo volume precisa estar montado em `web` e `worker`: o primeiro recebe o
arquivo e o segundo cria a publicação no Instagram. Não use dois volumes com
nomes diferentes. Em um proxy da Cloudflare, o envio é dividido em blocos
menores que 8 MB para caber no limite de cada requisição.

Suba a aplicação combinando os dois arquivos:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml build web
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d
```

Verifique o serviço depois da primeira subida e sempre após um deploy:

```bash
curl -fsS https://reply.iafotos.com.br/api/health
```

O resultado esperado é `"status":"ok"` e `"worker":{"healthy":true}`. Para investigar, use `docker compose -f docker-compose.yml -f docker-compose.server.yml logs -f web worker`.

### Publicar e acompanhar Stories

A página **Stories** permite montar uma sequência com até 20 quadros, salvar como rascunho, publicar imediatamente ou agendar. Cada arquivo vira um Story individual e a fila publica os quadros na ordem selecionada. Uma falha no meio da sequência fica marcada como parcial; os quadros já publicados não são enviados novamente numa retomada.

Stories usam o Instagram API com Facebook Login, pois o fluxo de publicação com Instagram Login não oferece esse formato. Na configuração de Facebook Login da Meta, conceda `instagram_content_publish` para publicar e `instagram_manage_insights` para métricas, além das permissões de leitura da Página exigidas pelo fluxo. A publicação de Stories exige uma conta Instagram Business vinculada a uma Página do Facebook. Conecte essa Página em **Configurações → Facebook** e selecione a Página associada à conta; o OpenReply tenta reconhecer vínculos que já estavam conectados. Se as permissões da configuração de Facebook Login mudarem, reconecte a Página.

O worker consulta métricas periodicamente durante a janela em que a Meta mantém o Story acessível. O OpenReply salva cópias das métricas disponíveis, mas a Meta pode omitir métricas dependendo da conta, da permissão e da idade do Story. A conclusão da sequência compara o alcance do primeiro e do último quadro; números ausentes aparecem como traço. **Duplicar para editar** cria um novo rascunho com os arquivos e a ordem da sequência publicada, sem republicar automaticamente.

### Publicar e analisar Trial Reels

No agendamento de um vídeo único, ative **Publicar como Reel de teste** e escolha como ele deve ser compartilhado depois:

- **Manual**: o Reel não é enviado automaticamente para todos; você decide depois se o compartilha.
- **Automático, se o desempenho for bom**: a Meta pode promovê-lo automaticamente para todos, conforme os sinais que ela usar.

O OpenReply envia `trial_params` com a estratégia escolhida. Trial Reels precisam ser um único vídeo; fotos e carrosséis não são aceitos. Eles começam fora do feed, então a opção normal **Mostrar também no feed** fica desativada nesse modo. Para Reels comuns, `share_to_feed` continua controlando se a publicação também aparece no feed. A conexão Instagram Login precisa conceder `instagram_business_content_publish` para publicar e `instagram_business_manage_insights` para consultar métricas; no Facebook Login, os nomes equivalentes são `instagram_content_publish` e `instagram_manage_insights`, junto das permissões de Página exigidas pelo fluxo. Consulte a [referência da API usada no projeto](https://github.com/moboutrig/instagram-claude-skill/blob/main/references/api_reference.md) e a [documentação de publicação de Reels da Meta](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

Depois da publicação, a Visão geral inclui o Reel de teste pelo ID retornado pela Meta e consulta as métricas disponíveis. A Meta pode levar algum tempo para liberá-las ou não disponibilizá-las para aquela publicação/conta. Nesse caso, a tabela informa que não há métricas retornadas e deixa os valores como traço, em vez de tratar a ausência como zero. A publicação também depende de a conta estar habilitada para Trial Reels e das permissões de conteúdo e insights do app.

O campo `location_id` é opcional na API, mas o OpenReply ainda não oferece busca nem seleção de localização. Para publicar um Trial Reel sem localização, deixe esse campo de fora; não use o nome do local no lugar do ID aceito pela Meta.

### 3. Criar o DNS no Cloudflare

1. No DNS da zona, crie um registro `A` para `reply` apontando para o IP público do servidor Docker.
2. Deixe o proxy da Cloudflare ativo se o Traefik estiver configurado para aceitar o tráfego HTTPS de origem.
3. Aguarde a propagação e abra `https://reply.iafotos.com.br/api/health` antes de configurar a Meta.
4. Caso o Traefik já tenha certificado TLS automático, não é necessário expor a porta da aplicação; ele encaminha internamente para a porta `3000` do container `web`.

### 4. Atualizar uma versão

Após alterar o código ou atualizar o repositório no servidor, execute:

```bash
cd /opt/openreply
docker compose -f docker-compose.yml -f docker-compose.server.yml build web
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --force-recreate web worker
curl -fsS https://reply.iafotos.com.br/api/health
```

Não use `docker compose` sem os dois arquivos nessa implantação: o arquivo base contém os bancos, enquanto o arquivo de servidor define `web` e `worker`.

## Environment variables

Copy `.env.example` to `.env` for local work, or set these in Vercel and Railway for hosting.

| Variable | What it is |
| --- | --- |
| `NEXTAUTH_URL` | Your public URL. Your Vercel domain in production, your tunnel URL locally. |
| `NEXTAUTH_SECRET` | Random secret. `openssl rand -base64 32` |
| `CRON_SECRET` | Random secret protecting the token-refresh cron. |
| `ENCRYPTION_KEY` | 32-byte hex. `openssl rand -hex 32`. Encrypts Instagram tokens. Identical across web and worker. |
| `DATABASE_URL` | PostgreSQL connection string. Public Railway URL on Vercel; internal on the worker. |
| `REDIS_URL` | Redis connection string. Must support blocking commands, so an HTTP-only Redis will not work with BullMQ. |
| `MEDIA_STORAGE_DIR` | Directory for photos and videos. Defaults to the system temporary directory for local development; set a persistent shared volume for production, mounted at the same path in the web app and worker. |
| `RESEND_API_KEY` | Resend key. Login is email magic links only, so without this nobody can sign in. |
| `EMAIL_FROM` | A sender on a domain you verified in Resend. The placeholder will not deliver. |
| `ALLOWED_EMAILS` | Optional. Comma-separated allowlist of addresses that may sign in, case insensitive. Unset, anyone who reaches your public URL can request a magic link and gets their own workspace, which is worth closing on an instance you run for yourself. |
| `EMAIL_SERVER` | Optional. An SMTP URL, for example `smtps://login%40example.com:password@mail.example.com:465`. Set it to send magic links through your own mail server instead of Resend; then `RESEND_API_KEY` is not needed. URL-encode special characters in the user and password (`@` becomes `%40`). Port 465 with `smtps://` is implicit TLS, port 587 with `smtp://` is STARTTLS. |
| `META_GRAPH_API_VERSION` | Graph API version, for example `v25.0`. |
| `INSTAGRAM_APP_ID` | From the Meta app, see Step 6. |
| `INSTAGRAM_APP_SECRET` | From the Meta app. |
| `FACEBOOK_APP_ID` | App settings, Basic, App ID. |
| `FACEBOOK_APP_SECRET` | App settings, Basic, App secret, click Show. |
| `FACEBOOK_LOGIN_CONFIG_ID` | The Configuration ID created in Facebook Login for Business. |
| `WEBHOOK_VERIFY_TOKEN` | Any random string. You paste the same value into Meta's webhook config. |

`ENCRYPTION_KEY` must be exactly 64 hex characters or the app throws on boot.

Optional, for tuning the polling reconciler (defaults are fine to start):

| Variable | Default | What it does |
| --- | --- | --- |
| `COMMENT_POLL_INTERVAL_MS` | `300000` | How often the worker sweeps for missed comments (5 min). |
| `COMMENT_POLL_MAX_PER_SWEEP` | `30` | Max new comments each campaign acts on per sweep. Keep it conservative; higher gets closer to Instagram's rate limits. |
| `COMMENT_POLL_LOOKBACK_HOURS` | `72` | How far back a sweep considers comments. |

## The Meta app

This is the slow part. The code works out of the box; getting Meta to send you comment events is where people lose an afternoon. Every step here exists because skipping it breaks something later. Have your Vercel domain from Step 3 ready, you will paste it in a few times.

### Step 4: Create the Meta app

Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and create an app.

- App type: Business.
- Contact email: one you actually check.

When it asks you to add a use case, filter to All, then choose Manage messaging and content on Instagram. Do not pick "Create and manage ads with Marketing API", and do not pick "Authenticate with Facebook Login". OpenReply uses Instagram Login. Picking the Facebook Login variant makes the OAuth flow fail later with a mismatched client error.

If you accidentally added the Marketing API use case, remove it. It has its own heavy review requirements and can block publishing.

### Step 5: Collect the three secrets

There are two app secrets and two app IDs, which is confusing. Here is what maps to what.

| Environment variable | Where it lives |
| --- | --- |
| `INSTAGRAM_APP_ID` | Instagram, API setup with Instagram login. A number like `2036...` |
| `INSTAGRAM_APP_SECRET` | Same page, click Show |
| `FACEBOOK_APP_SECRET` | App settings, Basic, App secret, click Show |

The Instagram app ID is not the same number as the Facebook App ID shown on the Basic settings page. Use the one under the Instagram product.

OpenReply verifies webhook signatures against both `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET`, so you do not have to guess which one Meta signs with. Set both.

### Step 6: Add your Instagram account as a tester, and accept the invite

This is the step people miss, and it produces the error "Insufficient Developer Role" on the Instagram login screen. In development, only accounts that have a role on your app can connect. Even your own account has to be added and accept.

There are two halves. Both are required.

Half one, on the Meta side. In the app dashboard, open App roles, then Roles (in the newer console this is also reachable from the Instagram product under "Generate access tokens"). Find the section for Instagram testers, click add, and enter the exact Instagram username of the account you want to connect. Send the invite.

Half two, on the Instagram side. This is the part that gets skipped. Open Instagram as that account (the phone app is easiest):

1. Go to your profile, then the menu, then Settings and activity.
2. Open Apps and websites (older versions: Website permissions, then Apps and websites).
3. Open Tester invites.
4. Accept the invite from your app.

Until you accept here, the account is not really a tester and the login will keep failing. If you do not see the invite, double-check you sent it to the exact username and that the account is a Business or Creator account.

To schedule posts, the OAuth request also asks for `instagram_business_content_publish`. Existing connections need to
reconnect from OpenReply Settings and accept that permission before the composer enables publishing. Accounts without
the permission can still create drafts. Meta requires Advanced Access and review for accounts outside your app's
roles.

### Step 7: Register the OAuth redirect

In the Instagram product, open Set up Instagram business login, then Business login settings. In the OAuth redirect URIs field, add exactly, using your Vercel domain:

```
https://your-app.vercel.app/api/instagram/callback
```

No trailing slash. If this is missing or wrong, connecting an account fails with a redirect_uri mismatch. You can register more than one, which is useful if you change domains later; keep the old and new both listed.

For the Docker + Cloudflare deployment documented above, the exact value is:

```
https://reply.iafotos.com.br/api/instagram/callback
```

You do not need the "Embed URL" that Meta shows here. OpenReply builds its own login URL. Users connect by opening your app, going to Settings, and clicking Connect Instagram.

### OAuth token flow: do not version the token-exchange endpoint

Instagram Login returns a short-lived token from `https://api.instagram.com/oauth/access_token`. Exchange that token with:

```
GET https://graph.instagram.com/access_token
grant_type=ig_exchange_token
client_secret=INSTAGRAM_APP_SECRET
access_token=SHORT_LIVED_TOKEN
```

The access-token exchange and refresh endpoints are unversioned. Profile calls, however, use the versioned Graph endpoint, for example `https://graph.instagram.com/v25.0/me`. Mixing these two URL forms leads to `Unsupported request` errors during connection. The deployed integration follows this pattern.

### Step 8: Configure the webhook

Still in the Instagram product, find the Configure webhooks step.

- Callback URL: `https://your-app.vercel.app/api/webhook`
- Verify token: the value of `WEBHOOK_VERIFY_TOKEN` from your environment
- Click Verify and save. It should succeed immediately, because the app answers Meta's verification challenge. If the button is greyed out, click into the verify-token field and paste the token again; editing the callback URL often clears it.
- Subscribe to the `comments` field, and to `messages` as well.

Both fields matter. `comments` carries comment-to-DM, which is what most people come here for. `messages` carries inbound DMs and Story replies, which is what a campaign's "also reply when someone DMs these words" toggle runs on. Subscribe to `comments` alone and that toggle looks enabled but never fires, because the events it needs are never delivered.

For the Docker + Cloudflare deployment documented above, use this callback URL:

```
https://reply.iafotos.com.br/api/webhook
```

To test delivery without a real comment, click Test next to `comments`, then click Send to My Server. This is a two-step control. Clicking Test only previews the sample payload; the second button is what actually POSTs it to your endpoint. After sending, a row should appear in your `WebhookEvent` table.

If your primary domain ever changes, update this callback URL to the new domain. A non-primary domain will 307-redirect the POST, and Meta does not reliably follow redirects, so webhooks silently stop.

### Step 9: Publish the app

Real comment webhooks are only delivered when the app is in Live state. In Development mode, only the console Test button delivers events. This is the single most common reason for "I set everything up and nothing happens."

Go to the Publish item in the left sidebar. Set the privacy policy, terms of service, and data deletion URLs first, or it will not let you publish. OpenReply ships these pages, on your Vercel domain:

```
https://your-app.vercel.app/privacy
https://your-app.vercel.app/data-deletion
https://your-app.vercel.app/terms
```

Then publish. Depending on your access level, Meta may let you go live for your own tester accounts immediately, or it may require App Review first (see the last section).

### Publishing is not Advanced Access: every account still needs a role on the app

This one costs an afternoon because the symptom points nowhere near the cause.

A published app still holds **Standard Access** to `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. Standard Access only covers Instagram accounts that have a role on your app — admins, developers, and Instagram testers. Publishing makes the app live; it does not widen who the permissions apply to. Advanced Access, which covers everyone else, comes only from App Review.

So connecting a second account fails even though the first one works, on the same app, with the same code.

The symptom: Instagram's consent screen appears and the login succeeds, the code exchange at `api.instagram.com/oauth/access_token` returns a normal `IGAA…` token with all the requested permissions — and then every single call against `graph.instagram.com` is refused:

```
Unsupported request - method type: get  [code=100, type=IGApiException]
```

`/access_token`, `/refresh_access_token`, `/me` — all of them, identically. Nothing about the message suggests a missing role, and the token itself looks fine.

The fix for your own accounts is the same two-part dance as Step 6, once per account: invite the Instagram username under App roles, Roles, Instagram testers, then accept the invite inside Instagram under Edit profile, Apps and websites, Tester invites. For accounts you do not control, you need App Review — see [META_APP_REVIEW.md](../META_APP_REVIEW.md).

### The account ID trap (informational)

You do not have to do anything here; OpenReply handles it. It is worth understanding because it is invisible when it goes wrong.

Meta's `/me` returns two IDs. The `id` field is app-scoped. The `user_id` field is the Instagram professional account ID. Webhooks put `user_id` in `entry.id`, and the messaging API keys off `user_id` too. OpenReply stores `user_id`, so a fresh connection matches correctly. If you upgraded from a very old build and an account was stored with the wrong ID, disconnect and reconnect it once.

## Facebook Login, Páginas e insights do Instagram

O login atual do Instagram continua funcionando para comentários e DMs. Porém, o produto **Instagram API com Instagram Login** não entrega todos os insights. Para métricas como alcance, visualizações, salvos e compartilhamentos, use também o **Facebook Login** e conecte a Página que está vinculada ao perfil profissional do Instagram.

1. Em **Meta for Developers**, configure o produto **Facebook Login for Business**. Em **Configurações do app > Básico**, adicione `reply.iafotos.com.br` em **Domínios do aplicativo** e cadastre a plataforma **Website** com a URL `https://reply.iafotos.com.br`.
2. Em **Valid OAuth Redirect URIs**, inclua exatamente:

   ```
   https://reply.iafotos.com.br/api/facebook/callback
   ```

3. Crie uma configuração do tipo **Geral** com **Token de acesso do usuário**. Selecione `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` e `pages_manage_metadata`. Copie o **Configuration ID** gerado.
4. No ambiente do servidor, defina `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` e `FACEBOOK_LOGIN_CONFIG_ID` (o Configuration ID). O segredo também assina os webhooks.
5. No produto Webhooks, mantenha a URL única já usada pelo app:

   ```
   https://reply.iafotos.com.br/api/webhook
   ```

   Assine os campos de Página `messages`, `messaging_postbacks` e `feed`. Para o Instagram, mantenha `comments` e `messages`.
6. Em **Configurações** do OpenReply, use **Conectar Facebook**, faça o login e escolha a Página correta. A escolha é explícita; o app não conecta todas as suas Páginas automaticamente.

Em modo de desenvolvimento, a pessoa que fizer a autorização precisa ter uma função no app da Meta. Para clientes que não possuem função no app, essas permissões exigem Advanced Access e App Review.

> A conexão da Página não substitui nem remove uma conexão existente do Instagram. A integração completa de automações de Messenger e a troca do token de Instagram para Facebook Login devem ser ativadas depois que os produtos, permissões e campos de webhook estiverem aprovados na Meta.

## Test it end to end

1. Make sure the account is a tester and has accepted the invite (Step 6), and the app is published (Step 9).
2. Connect it in the app: Settings, Connect Instagram. You should reach Instagram's consent screen, not the "Insufficient Developer Role" error.
3. Create a campaign on one of your posts with a keyword like `TEST`.
4. From a different Instagram account, comment `TEST` on that post. It must be a different account, because OpenReply ignores your own comments on purpose.
5. Watch for the DM. If nothing arrives, check the DM Logs page and `/api/health`.

Hit `/api/health` any time. It reports the database, Redis, queue, and worker heartbeat. If `worker.healthy` is false, the worker is not running or cannot reach Redis, and no DM will send even though webhooks are being received.

If you want to inspect where a comment stopped, the Postgres tables tell you: `WebhookEvent` for delivery, `DmLog` for send status and errors, `OperationalEvent` for worker crashes and the polling reconciler's sweep logs.

## Local development

You need Postgres and Redis. The included `docker-compose.yml` starts both:

```bash
docker-compose up -d
npm run db:generate
npm run db:migrate
```

Or install them natively (macOS):

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb openreply
```

Then set `DATABASE_URL` to match your local user, for example `postgresql://YOUR_USER@localhost:5432/openreply`.

Run the two processes in separate terminals:

```bash
npm run dev
npm run worker
```

For Meta to reach your local webhook, run a tunnel and point `NEXTAUTH_URL` and the Meta webhook and redirect URLs at the tunnel:

```bash
ngrok http 3000
```

## Set it up with an AI assistant

If you run an AI coding assistant like Claude Code or Cursor, it can drive most of this for you. Open a clone of this repo inside your assistant and paste the prompt below. Give it your keys as it asks for them.

A word of caution: the assistant will need real secrets to finish (Meta app secrets, a Resend key, database URLs). Only paste those into a tool and environment you trust, and rotate them afterward if you are unsure.

```
You are helping me self-host OpenReply, an open source Instagram comment-to-DM
automation tool, in this repository. Read README.md and docs/setup.md first, then
help me get it running end to end.

My goal: <describe it. For example: run it for my own Instagram account only,
or host it for other people to sign up.>

Work through this in order and stop to ask me whenever you need a value or an
action only I can do:

1. Local or hosted. Ask me which I want. If hosted, we use Vercel for the web
   app (its domain becomes my public URL) and Railway for the worker plus
   Postgres and Redis. If local, we use docker-compose and a tunnel.

2. Datastores. Help me get a Postgres and a Redis running, then run the Prisma
   migration against them.

3. Environment. Generate NEXTAUTH_SECRET, CRON_SECRET, ENCRYPTION_KEY, and
   WEBHOOK_VERIFY_TOKEN for me. Ask me for my Resend API key and a verified
   sender address, and for the three Meta secrets once I create the app. Make
   sure ENCRYPTION_KEY is identical on the web app and the worker.

4. Deploy both processes and confirm /api/health returns ok with the worker
   healthy.

5. Meta app. Walk me through the Meta app section of docs/setup.md one step at a
   time. This is the slow part. Tell me exactly what to click and what to paste,
   using my Vercel domain for the OAuth redirect and webhook. Remember the
   account ID trap (store user_id, not id) and that the app must be published
   for real webhooks to arrive.

6. Test. Have me create a campaign and comment a keyword from a second account,
   then confirm the DM sent by checking the DmLog table and the DM Logs page.

Rules for you:
- Never invent Meta dashboard steps. If a screen does not match the guide, ask
  me to screenshot it.
- Diagnose failures by querying the Postgres tables directly: WebhookEvent for
  delivery, DmLog for send status, OperationalEvent for worker errors. This is
  faster than logs.
- Remind me to rotate any secret I paste to you before real use.

Start by reading the docs, then ask me question 1.
```

By the end, `/api/health` returns `status: ok` with `worker.healthy: true`, and a comment with your keyword from a second account produces a `SENT` row in the DM logs. If you get there, you are done.

## Letting other people use your instance

Everything above is enough to run OpenReply for your own accounts, or a handful of accounts you add as testers. No App Review needed.

For a stranger to connect their own Instagram to your hosted instance, Meta requires App Review granting Advanced Access on the messaging and comments permissions. That means:

- A screencast of the full flow working, recorded on real accounts in one take.
- A written justification for each permission. Drafts are in [../META_APP_REVIEW.md](../META_APP_REVIEW.md).
- Business verification, which asks for a document proving a legal business entity: a business registration or license, articles of incorporation, a business tax document, or a business bank statement.

Meta scrutinizes automated-DM apps and often rejects the first submission, so budget for a resubmit. If you do not have a registered business, most self-hosters skip this entirely by running their own instance for their own account, which never needs review.

## Security notes

- `.env` is gitignored. Keep it that way.
- Rotate any secret that has been pasted anywhere it could be logged, including a chat with an AI assistant.
- Instagram tokens are encrypted at rest with `ENCRYPTION_KEY`. Losing or changing it means every connected account has to reconnect.
