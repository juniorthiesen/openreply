interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({
  label,
  value,
  detail,
  trend,
  trendUp,
}: StatCardProps) {
  return (
    <article className="panel flex min-h-[142px] flex-col justify-between p-5 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <p className="text-sm font-medium text-muted">{label}</p>
      </div>
      <p className="mt-4 font-display text-[2rem] font-bold leading-none tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      {(detail || trend) && (
        <p className="mt-3 text-xs leading-5 text-muted">
          {detail}
          {trend && (
            <span className={trendUp ? "text-success" : "text-error"}>
              {detail ? " · " : ""}
              {trendUp ? "Aumento " : "Redução "}
              {trend}
            </span>
          )}
        </p>
      )}
    </article>
  );
}
