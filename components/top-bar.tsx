"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Painel",
  "/overview": "Visão geral",
  "/inbox": "Caixa de entrada",
  "/campaigns": "Campanhas",
  "/feed": "Feed",
  "/schedule": "Agendar post",
  "/schedule/bulk": "Subir posts em massa",
  "/campaigns/new": "Nova campanha",
  "/campaigns/import": "Importar campanhas",
  "/automations": "Campanhas",
  "/automations/new": "Nova campanha",
  "/logs": "Registros de DM",
  "/settings": "Configurações",
  "/diagnostics": "Diagnóstico",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/campaigns/") ? "Campanha" : "Painel");

  return (
    <header
      className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 lg:px-8"
      style={{
        height: "calc(4.5rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-foreground hover:bg-surface-hover lg:hidden"
          aria-label="Abrir menu lateral"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="min-w-0">
          <p className="hidden text-[11px] font-medium text-muted sm:block">
            FISGA
          </p>
          <p className="truncate font-display text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {title}
          </p>
        </div>
      </div>

      {instagramAccountCount > 0 ? (
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2 sm:px-3.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <path d="M17.5 6.5h.01" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block max-w-[9rem] truncate text-xs font-semibold text-foreground sm:max-w-[14rem] sm:text-sm">
              {instagramAccountCount > 1
                ? instagramAccountCount + " contas conectadas"
                : "@" + instagramUsername}
            </span>
            <span className="hidden text-[11px] text-muted sm:block">
              Instagram
            </span>
          </span>
          <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-success" />
        </div>
      ) : (
        <a
          href="/api/instagram/connect"
          className="inline-flex h-10 shrink-0 items-center rounded-xl bg-accent px-3.5 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
        >
          <span className="sm:hidden">Conectar</span>
          <span className="hidden sm:inline">Conectar Instagram</span>
        </a>
      )}
    </header>
  );
}
