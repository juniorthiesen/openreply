"use client";

import { useEffect, useState } from "react";
import { apiRequest, formatDateTime } from "@/components/scheduling/shared";
import type { AbPanelData, AbTestView, AbVariantResult } from "@/lib/ab/results";

const WEIGHT_OPTIONS = [30, 40, 50, 60, 70];
const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

function VariantCard({ variant, test }: { variant: AbVariantResult; test: AbTestView }) {
  const isWinner = test.winnerKey === variant.key;
  const isLeader = test.summary.leader === variant.key;
  const share = variant.key === "A" ? test.weightA : 100 - test.weightA;

  return (
    <article
      className={`panel flex flex-col gap-4 rounded p-4 ${isWinner ? "border-success/60" : isLeader && test.summary.decisive ? "border-success/40" : ""}`}
      aria-label={`Variante ${variant.key}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Variante {variant.key}</h3>
          <p className="text-xs text-muted">{share}% das pessoas</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {isWinner && <span className="rounded bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">Vencedora</span>}
          {!isWinner && isLeader && (
            <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
              {test.summary.decisive ? "Melhor" : "Na frente"}
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted">Taxa de clique</p>
        <p className="text-3xl font-semibold tabular-nums text-foreground">
          {variant.ratePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded bg-surface-hover p-2.5">
          <dt className="text-[11px] text-muted">DMs enviadas</dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">{variant.sent.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="rounded bg-surface-hover p-2.5">
          <dt className="text-[11px] text-muted">Pessoas que clicaram</dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">{variant.clickers.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="rounded bg-surface-hover p-2.5">
          <dt className="text-[11px] text-muted">Cliques</dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">{variant.clicks.toLocaleString("pt-BR")}</dd>
        </div>
      </dl>

      <div className="space-y-2 text-sm">
        <div>
          <p className="text-xs text-muted">Mensagem</p>
          <p className="whitespace-pre-wrap rounded border border-border bg-surface px-3 py-2 text-foreground">{variant.dmMessage}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Botão</p>
            <p className="rounded border border-border bg-surface px-3 py-2 text-foreground">{variant.linkButtonLabel || "Abrir link"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted">Link</p>
            <p className="break-all rounded border border-border bg-surface px-3 py-2 text-foreground">{variant.destinationUrl ?? "Sem link"}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function AbTestPanel({ automationId }: { automationId: string }) {
  const [data, setData] = useState<AbPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "end" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [label, setLabel] = useState("");
  const [urlB, setUrlB] = useState("");
  const [urlA, setUrlA] = useState("");
  const [weightA, setWeightA] = useState(50);

  const endpoint = `/api/automations/ab-test?id=${encodeURIComponent(automationId)}`;

  function prefill(next: AbPanelData) {
    setMessage(next.defaults.dmMessage);
    setLabel(next.defaults.linkButtonLabel ?? "");
    setUrlB("");
    setUrlA("");
  }

  useEffect(() => {
    let mounted = true;
    apiRequest<AbPanelData>(`/api/automations/ab-test?id=${encodeURIComponent(automationId)}`)
      .then((next) => {
        if (!mounted) return;
        setData(next);
        prefill(next);
      })
      .catch((loadFailure) => {
        if (mounted) setLoadError(loadFailure instanceof Error ? loadFailure.message : "Não foi possível carregar o teste.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [automationId]);

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      setData(await apiRequest<AbPanelData>(endpoint));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Não foi possível atualizar.");
    } finally {
      setBusy(null);
    }
  }

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("start");
    setError(null);
    setNotice(null);
    try {
      const next = await apiRequest<AbPanelData>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          weightA,
          aDestinationUrl: urlA || undefined,
          b: { dmMessage: message, linkButtonLabel: label || null, destinationUrl: urlB },
        }),
      });
      setData(next);
      setNotice("Teste iniciado. As próximas pessoas já recebem a variante A ou a B.");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível iniciar o teste.");
    } finally {
      setBusy(null);
    }
  }

  async function end(winner: "A" | "B" | null) {
    const question =
      winner === null
        ? "Encerrar o teste sem escolher um vencedor? A campanha continua como estava antes do teste."
        : `Escolher a variante ${winner} como vencedora? A mensagem, o botão e o link dela passam a ser os da campanha, e o teste termina.`;
    if (!window.confirm(question)) return;

    setBusy("end");
    setError(null);
    setNotice(null);
    try {
      const next = await apiRequest<AbPanelData>(endpoint, { method: "PUT", body: JSON.stringify({ winner }) });
      setData(next);
      prefill(next);
      setNotice(winner ? `Variante ${winner} aplicada à campanha. O teste foi encerrado.` : "Teste encerrado. A campanha continua como estava.");
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Não foi possível encerrar o teste.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="panel h-40 rounded" aria-busy="true" />;
  if (loadError || !data) {
    return (
      <p role="alert" className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
        {loadError ?? "Não foi possível carregar o teste."}
      </p>
    );
  }

  const test = data.test;
  const running = test?.status === "RUNNING";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Teste A/B</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Compare duas versões da DM com o link: cada pessoa recebe só uma delas, sempre a mesma, e a Fisga conta quem clicou em cada uma.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border border-success/30 bg-success/5 p-3 text-sm text-success">
          {notice}
        </p>
      )}

      {test && (
        <section className="space-y-4" aria-label="Resultados do teste">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {running ? "Em andamento" : "Encerrado"} · iniciado em {formatDateTime(test.startedAt)}
              {test.endedAt ? ` · encerrado em ${formatDateTime(test.endedAt)}` : ""}
            </p>
            {running && (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy !== null}
                className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                {busy === "refresh" ? "Atualizando…" : "Atualizar resultados"}
              </button>
            )}
          </div>

          <p
            className={`rounded border p-3 text-sm ${test.summary.decisive ? "border-success/30 bg-success/5 text-foreground" : "border-border bg-surface text-foreground"}`}
          >
            {test.summary.verdict}
            {test.summary.probabilityBBeatsA !== null && (
              <span className="ml-1 text-muted">
                (chance de B ser melhor que A: {Math.round(test.summary.probabilityBBeatsA * 100)}%)
              </span>
            )}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <VariantCard variant={test.variants[0]} test={test} />
            <VariantCard variant={test.variants[1]} test={test} />
          </div>

          {running ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void end("A")}
                disabled={busy !== null}
                className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                Escolher A como vencedora
              </button>
              <button
                type="button"
                onClick={() => void end("B")}
                disabled={busy !== null}
                className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                Escolher B como vencedora
              </button>
              <button
                type="button"
                onClick={() => void end(null)}
                disabled={busy !== null}
                className="rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                Encerrar sem vencedor
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">
              {test.winnerKey
                ? `A variante ${test.winnerKey} foi aplicada à campanha.`
                : "Este teste terminou sem vencedor, e a campanha ficou como estava."}
            </p>
          )}

          {running && (
            <p className="text-xs text-muted">
              Enquanto o teste roda, a mensagem, o botão e o link da DM ficam travados na campanha. A taxa é de pessoas que clicaram sobre DMs enviadas, sem contar cliques de robôs de pré-visualização.
            </p>
          )}
        </section>
      )}

      {!running && (
        <form onSubmit={start} className="panel space-y-4 rounded p-4 sm:p-5" aria-label="Novo teste A/B">
          <h3 className="text-sm font-semibold text-foreground">{test ? "Novo teste" : "Criar um teste"}</h3>

          <div className="rounded border border-border bg-surface p-3 text-sm">
            <p className="text-xs font-medium text-muted">Variante A: a campanha como está hoje</p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{data.defaults.dmMessage}</p>
            <p className="mt-1 break-all text-xs text-muted">
              Botão: {data.defaults.linkButtonLabel || "Abrir link"} · Link: {data.defaults.destinationUrl ?? "sem link"}
            </p>
          </div>

          {!data.defaults.destinationUrl && (
            <div>
              <label htmlFor="ab-url-a" className="mb-1 block text-sm font-medium text-foreground">
                Link da variante A
              </label>
              <input
                id="ab-url-a"
                type="url"
                inputMode="url"
                required
                maxLength={2000}
                value={urlA}
                onChange={(event) => setUrlA(event.target.value)}
                placeholder="https://"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">Esta campanha ainda não tem link. Sem link não há cliques para comparar.</p>
            </div>
          )}

          <div>
            <label htmlFor="ab-message-b" className="mb-1 block text-sm font-medium text-foreground">
              Mensagem da variante B
            </label>
            <textarea
              id="ab-message-b"
              required
              rows={4}
              maxLength={1000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">Começa igual à A. Mude o que quiser testar.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ab-label-b" className="mb-1 block text-sm font-medium text-foreground">
                Texto do botão da B
              </label>
              <input
                id="ab-label-b"
                maxLength={20}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Abrir link"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ab-url-b" className="mb-1 block text-sm font-medium text-foreground">
                Link da variante B
              </label>
              <input
                id="ab-url-b"
                type="url"
                inputMode="url"
                required
                maxLength={2000}
                value={urlB}
                onChange={(event) => setUrlB(event.target.value)}
                placeholder="https://"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ab-weight" className="mb-1 block text-sm font-medium text-foreground">
              Divisão das pessoas
            </label>
            <select
              id="ab-weight"
              value={weightA}
              onChange={(event) => setWeightA(Number(event.target.value))}
              className={`${inputClass} sm:max-w-xs`}
            >
              {WEIGHT_OPTIONS.map((weight) => (
                <option key={weight} value={weight}>
                  A {weight}% · B {100 - weight}%
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-muted">
            Para você ver a variante também no seu Google Analytics ou na sua loja, acrescentamos utm_source, utm_medium, utm_campaign e utm_content aos links do teste (sem trocar os que você já tiver).
          </p>

          <button
            type="submit"
            disabled={busy !== null}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "start" ? "Iniciando…" : "Iniciar teste"}
          </button>
        </form>
      )}
    </div>
  );
}
