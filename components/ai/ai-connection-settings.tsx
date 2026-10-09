"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/components/scheduling/shared";
import type { AiConnectionView } from "@/lib/ai/connection";

interface ModelTestResult {
  model: string;
  role: "principal" | "reserva";
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface TestResult {
  ok: boolean;
  tested: boolean;
  latencyMs?: number;
  model?: string;
  models: string[];
  results: ModelTestResult[];
}

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

export default function AiConnectionSettings() {
  const [view, setView] = useState<AiConnectionView | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [fallbackModels, setFallbackModels] = useState("");
  const [testResults, setTestResults] = useState<ModelTestResult[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function applyView(next: AiConnectionView) {
    setView(next);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setFallbackModels(next.fallbackModels.join(", "));
    setTestResults([]);
    setEnabled(next.source === "none" ? true : next.enabled);
    setApiKey("");
  }

  useEffect(() => {
    let mounted = true;
    apiRequest<AiConnectionView>("/api/ai/connection")
      .then((data) => { if (mounted) applyView(data); })
      .catch(() => { if (mounted) setAllowed(false); });
    return () => { mounted = false; };
  }, []);

  // Only people who manage the workspace see this section.
  if (!allowed || !view) return null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const next = await apiRequest<AiConnectionView>("/api/ai/connection", {
        method: "PUT",
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined, model, fallbackModels, enabled }),
      });
      applyView(next);
      setNotice(enabled ? "Salvo. O assistente de IA está ativo." : "Salvo. O assistente de IA está desligado.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<TestResult>("/api/ai/connection/test", {
        method: "POST",
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined, model: model || undefined, fallbackModels }),
      });
      if (result.models.length > 0) setModels(result.models);
      setTestResults(result.results ?? []);
      if (!result.tested) {
        setNotice(
          result.models.length > 0
            ? `Conexão ok. ${result.models.length} modelos disponíveis: escolha um no campo Modelo.`
            : "Conexão ok, mas o serviço não listou modelos. Digite o nome do modelo."
        );
      } else {
        const seconds = ((result.latencyMs ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
        setNotice(
          result.ok
            ? `Conexão ok. O modelo ${result.model} respondeu em ${seconds} s.`
            : `O modelo principal ${result.model} falhou no teste. Veja o resultado abaixo.`
        );
      }
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Não foi possível testar.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Remover a configuração de IA deste espaço de trabalho?")) return;
    setBusy("remove");
    setError(null);
    setNotice(null);
    try {
      const next = await apiRequest<AiConnectionView>("/api/ai/connection", { method: "DELETE" });
      applyView(next);
      setNotice(
        next.source === "environment"
          ? "Configuração removida. O assistente voltou a usar a configuração do servidor."
          : "Configuração removida."
      );
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover.");
    } finally {
      setBusy(null);
    }
  }

  const keyPlaceholder = view.keyHint ? `${view.keyHint} (deixe em branco para manter)` : "Cole a chave de acesso";
  const canTest = Boolean(baseUrl.trim() && (apiKey.trim() || view.keyHint || view.source === "environment"));

  return (
    <section className="panel rounded p-4 sm:p-6" aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title" className="mb-2 text-base font-semibold">Assistente de IA</h2>
      <p className="mb-5 text-xs leading-5 text-muted">
        Conecte um serviço de IA compatível com a API da OpenAI para criar rascunhos de campanha e variações de
        resposta. Só o texto que você escreve nesses pedidos é enviado a esse serviço. A chave é guardada
        criptografada e não volta para o navegador.
      </p>

      {view.source === "environment" && (
        <p className="mb-4 rounded border border-accent/30 bg-accent/5 p-3 text-xs text-foreground">
          Hoje o assistente usa a configuração padrão do servidor. Salve os campos abaixo para usar a sua própria.
        </p>
      )}

      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="ai-base-url" className="mb-1 block text-sm font-medium text-foreground">
            Endereço (URL)
          </label>
          <input
            id="ai-base-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={300}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://seu-servico.com/v1"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="ai-api-key" className="mb-1 block text-sm font-medium text-foreground">
            Chave
          </label>
          <input
            id="ai-api-key"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={500}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={keyPlaceholder}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="ai-model" className="mb-1 block text-sm font-medium text-foreground">
            Modelo
          </label>
          <input
            id="ai-model"
            list="ai-model-options"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={100}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Nome do modelo"
            className={inputClass}
          />
          <datalist id="ai-model-options">
            {models.map((name) => <option key={name} value={name} />)}
          </datalist>
          <p className="mt-1 text-xs text-muted">Use “Testar conexão” para listar os modelos do serviço.</p>
        </div>

        <div>
          <label htmlFor="ai-fallback-models" className="mb-1 block text-sm font-medium text-foreground">
            Modelos reserva <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            id="ai-fallback-models"
            list="ai-model-options"
            autoComplete="off"
            spellCheck={false}
            maxLength={400}
            value={fallbackModels}
            onChange={(event) => setFallbackModels(event.target.value)}
            placeholder="Separe por vírgula, até 3"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            Se o modelo principal falhar ou demorar, a IA tenta estes, na ordem, e avisa qual foi usado.
            {view.implicitFallbackModels.length > 0 && !fallbackModels.trim()
              ? ` Em branco, usamos o padrão do servidor: ${view.implicitFallbackModels.join(", ")}.`
              : ""}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Ativar o assistente de IA
        </label>

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
        {testResults.length > 0 && (
          <ul className="space-y-1 rounded border border-border bg-surface p-3 text-xs" aria-label="Resultado do teste por modelo">
            {testResults.map((result) => (
              <li key={`${result.role}-${result.model}`} className={result.ok ? "text-foreground" : "text-error"}>
                <span aria-hidden="true">{result.ok ? "✓" : "✕"}</span>{" "}
                <span className="font-medium">{result.role === "principal" ? "Principal" : "Reserva"}</span>{" "}
                {result.model}:{" "}
                {result.ok
                  ? `respondeu em ${((result.latencyMs ?? 0) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`
                  : result.error}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy !== null || !baseUrl.trim() || !model.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "save" ? "Salvando…" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy !== null || !canTest}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "test" ? "Testando…" : "Testar conexão"}
          </button>
          {view.source === "workspace" && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
              className="ml-auto text-sm text-muted hover:text-error disabled:opacity-50"
            >
              {busy === "remove" ? "Removendo…" : "Remover configuração"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
