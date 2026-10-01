"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavIconName = "home" | "chart" | "growth" | "inbox" | "campaigns" | "feed" | "schedule" | "stories" | "logs" | "settings" | "diagnostics";

const navItems: Array<{ label: string; href: string; icon: NavIconName }> = [
  { label: "Painel", href: "/dashboard", icon: "home" },
  { label: "Visão geral", href: "/overview", icon: "chart" },
  { label: "Crescimento", href: "/growth", icon: "growth" },
  { label: "Caixa de entrada", href: "/inbox", icon: "inbox" },
  { label: "Campanhas", href: "/campaigns", icon: "campaigns" },
  { label: "Feed", href: "/feed", icon: "feed" },
  { label: "Agendar post", href: "/schedule", icon: "schedule" },
  { label: "Stories", href: "/stories", icon: "stories" },
  { label: "Registros de DM", href: "/logs", icon: "logs" },
  { label: "Configurações", href: "/settings", icon: "settings" },
  { label: "Diagnóstico", href: "/diagnostics", icon: "diagnostics" },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "home" && (
        <>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
      )}
      {name === "chart" && (
        <>
          <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
        </>
      )}
      {name === "growth" && (
        <>
          <path d="M3 17 9 11l4 3 8-9" />
          <path d="M15 5h6v6" />
        </>
      )}
      {name === "inbox" && (
        <>
          <path d="M3 13l3-8h12l3 8v6H3z" />
          <path d="M3 13h5l1 3h6l1-3h5" />
      </>
      )}
      {name === "campaigns" && (
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
      )}
      {name === "feed" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
      </>
      )}
      {name === "schedule" && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
      </>
      )}
      {name === "stories" && (
        <>
          <rect x="4" y="4" width="16" height="16" rx="6" strokeDasharray="2.5 2.5" />
          <path d="M12 8v8M8 12h8" />
        </>
      )}
      {name === "logs" && (
        <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
      )}
      {name === "settings" && (
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
      )}
      {name === "diagnostics" && (
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      )}
    </svg>
  );
}

export default function Sidebar({ isOpen, onClose, workspaceName }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-foreground/45 lg:hidden"
          onClick={onClose}
          aria-label="Fechar menu"
        />
      )}

      <aside
        aria-label="Navegação principal"
        className={
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-[268px] max-w-[86vw] shrink-0 flex-col border-r border-border bg-sidebar transition-transform duration-200 ease-out lg:static lg:z-auto lg:h-full lg:max-w-none lg:translate-x-0 " +
          (isOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div
          className="flex items-center gap-3 px-5 pb-5"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-foreground text-accent">
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3 2v-5a7.5 7.5 0 1 1 16-4.5Z" />
              <path d="M8 12h.01M12 12h.01M16 12h.01" />
            </svg>
          </span>
          <div className="min-w-0">
            <Link
              href="/dashboard"
              className="font-display text-[22px] font-bold leading-none tracking-tight text-foreground"
              onClick={onClose}
            >
              FISGA
            </Link>
            <p className="mt-1 text-[11px] font-medium text-muted">
              Automação de DMs
            </p>
          </div>
        </div>

        <div className="mx-3 mb-5 rounded-xl border border-border bg-surface/70 px-3 py-3">
          <p className="text-[11px] text-muted">Espaço de trabalho</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {workspaceName}
          </p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          <p className="px-3 pb-2 pt-1 text-xs font-medium text-muted">Menu</p>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={
                  "relative flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors " +
                  (isActive
                    ? "bg-surface font-semibold text-accent shadow-[0_1px_2px_rgba(22,24,29,0.08)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent"
                    : "text-muted hover:bg-surface/70 hover:text-foreground")
                }
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-medium text-foreground">Instalação própria</p>
          <p className="mt-1 text-xs text-muted">Sua automação, no seu espaço</p>
        </div>
      </aside>
    </>
  );
}
