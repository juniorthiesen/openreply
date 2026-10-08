"use client";

import { Suspense, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { FacebookConnectNotice } from "@/components/facebook-connect-notice";
import { InstagramManualTokenForm } from "@/components/instagram-manual-token-form";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
      publishingPermissionGranted: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface FacebookPageData {
  id: string;
  facebookPageId: string;
  name: string;
  username: string | null;
  webhookSubscribed: boolean;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [facebookPages, setFacebookPages] = useState<FacebookPageData[]>([]);
  const [facebookError, setFacebookError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
      fetch("/api/facebook/pages").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload, facebookPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
        if (facebookPayload.success) setFacebookPages(facebookPayload.data.pages);
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm("Desconectar o Instagram? As campanhas desta conta deixarão de enviar DMs.")) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function disconnectFacebookPage(page: FacebookPageData) {
    if (!confirm(`Desconectar a Página “${page.name}” do FISGA? Isso remove o vínculo no FISGA, mas não revoga o acesso do app nas configurações do Facebook.`)) {
      return;
    }

    setFacebookError(null);
    setBusy(`facebook:${page.id}`);
    try {
      const response = await fetch("/api/facebook/pages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: page.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setFacebookError(payload.error ?? "Não foi possível desconectar a Página.");
        return;
      }
      setFacebookPages((current) => current.filter((item) => item.id !== page.id));
    } catch {
      setFacebookError("Não foi possível desconectar a Página. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Não foi possível convidar o membro");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  if (loading) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>
      <Suspense fallback={null}>
        <FacebookConnectNotice />
      </Suspense>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Conexão do Instagram</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Os webhooks de comentários e as respostas privadas dependem desta conexão.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? "Conectado" : "Não conectado"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Contas</p>
              <p className="text-xs text-muted mt-0.5">
                {accounts.length} {accounts.length === 1 ? "perfil" : "perfis"} do Instagram conectado
                {accounts.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? `${accounts.length} conectada${accounts.length === 1 ? "" : "s"}` : "Nenhuma"}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Conecte uma conta profissional do Instagram para criar campanhas.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Token expira{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString()
                      : "indisponível"}{" "}
                    · {account.webhookSubscribed ? "Webhook pronto" : "Webhook pendente"}
                  </p>
                  {!account.publishingPermissionGranted && (
                    <p className="mt-2 text-xs text-warning">
                      A permissão de publicação ainda não foi autorizada nesta conta, ou a Meta a recusou. Reconecte o Instagram para autorizá-la.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!account.publishingPermissionGranted && (
                    <a
                      href="/api/instagram/connect"
                      className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Reconectar Instagram
                    </a>
                  )}
                  <button
                    onClick={() => disconnectInstagram(account.id)}
                    disabled={busy === `disconnect:${account.id}`}
                    className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                  >
                    {busy === `disconnect:${account.id}`
                      ? "Desconectando..."
                      : "Desconectar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <a
            href="/api/instagram/connect"
            className="px-4 py-2 rounded text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
          >
            {accounts.length > 0 ? "Conectar outra conta" : "Conectar Instagram"}
          </a>
        </div>
        <InstagramManualTokenForm />
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-2">Página do Facebook</h2>
        <p className="mb-5 text-sm text-muted">Conecte uma Página para preparar as mensagens do Messenger, comentários e a migração do Instagram para o Facebook Login.</p>
        {facebookError && (
          <p role="alert" className="mb-4 rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {facebookError}
          </p>
        )}
        <div className="space-y-3">
          {facebookPages.length === 0 ? (
            <p className="rounded border border-border bg-surface/70 p-4 text-sm text-muted">Nenhuma Página conectada.</p>
          ) : facebookPages.map((page) => (
            <div key={page.id} className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{page.name}</p>
                <p className="mt-1 text-xs text-muted">{page.webhookSubscribed ? "Webhook solicitado" : "Webhook pendente"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">Conectada</span>
                <button
                  type="button"
                  onClick={() => void disconnectFacebookPage(page)}
                  disabled={busy === `facebook:${page.id}`}
                  className="inline-flex items-center justify-center rounded border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `facebook:${page.id}` ? "Desconectando..." : "Desconectar"}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <a href="/api/facebook/connect" className="inline-flex rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
            {facebookPages.length ? "Conectar outra Página" : "Conectar Facebook"}
          </a>
        </div>
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Equipe</h2>
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? "Membro desconhecido"}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {member.role}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Convites pendentes
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      Copiar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      Revogar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@agency.com"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">Membro</option>
              <option value="ADMIN">Administrador</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? "Convidando..." : "Convidar"}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Uso</h2>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs enviadas neste mês
            </p>
            <p className="text-xs text-muted mt-0.5">
              Auto-hospedado — sem limites de plano.
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </section>
    </div>
  );
}
