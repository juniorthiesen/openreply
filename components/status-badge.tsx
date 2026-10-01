/** Rótulo visual para os resultados de cada DM. */

const statusConfig: Record<string, { color: string; label: string }> = {
  SENT: { color: "bg-success/10 text-success", label: "Enviada" },
  FAILED: { color: "bg-error/10 text-error", label: "Falhou" },
  PENDING: { color: "bg-warning/10 text-warning", label: "Pendente" },
  SKIPPED_DEDUP: { color: "bg-surface-hover text-muted", label: "Duplicada" },
  SKIPPED_RATE_LIMIT: { color: "bg-warning/10 text-warning", label: "Limite de envio" },
  SKIPPED_PLAN_LIMIT: { color: "bg-warning/10 text-warning", label: "Limite do plano" },
  SKIPPED_NO_MATCH: { color: "bg-surface-hover text-muted", label: "Sem correspondência" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${config.color}`}>
      {config.label}
    </span>
  );
}
