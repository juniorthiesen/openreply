import type { z } from "zod";
import {
  AiError,
  describeFailureReason,
  isModelSpecificFailure,
  type AiFailureReason,
} from "@/lib/ai/errors";
import { assertSafeAiUrl } from "@/lib/ai/url-safety";

export { AiError };

/** What it takes to talk to an OpenAI-compatible API. */
export interface AiEndpoint {
  /** Base URL, for example https://host/v1. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Models to try, in order, when the main one fails. */
  fallbackModels?: string[];
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** One model that was tried and failed before another one answered. */
export interface AiAttemptFailure {
  model: string;
  reason: AiFailureReason;
  message: string;
}

export interface AiRunResult<T> {
  data: T;
  usage: AiUsage;
  /** The model that actually produced the answer. */
  modelUsed: string;
  /** Models that failed first, in order. Empty when the main model answered. */
  failures: AiAttemptFailure[];
}

// The app sits behind a CDN that gives up on a request after about 100 seconds,
// so the whole chain has to finish well before that, however many models it tries.
const ATTEMPT_TIMEOUT_MS = 35_000;
const TOTAL_BUDGET_MS = 85_000;
const MIN_ATTEMPT_MS = 5_000;
const MODELS_TIMEOUT_MS = 15_000;
const BAD_FORMAT_MESSAGE = "A IA devolveu uma resposta fora do formato esperado. Tente de novo.";

/** Join the text deltas of a Server-Sent Events chat stream. Some routers stream even when not asked to. */
export function readSseContent(raw: string): { text: string; model: string | null } {
  let text = "";
  let model: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as {
        model?: string;
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      if (!model && typeof chunk.model === "string") model = chunk.model;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      // Ignore keep-alive or partial fragments.
    }
  }
  return { text, model };
}

/** Pull one JSON object out of model text, tolerating ```json fences and surrounding prose. */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new AiError(BAD_FORMAT_MESSAGE, 424, "bad_format");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError(BAD_FORMAT_MESSAGE, 424, "bad_format");
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function requestCompletion(
  endpoint: Pick<AiEndpoint, "baseUrl" | "apiKey">,
  model: string,
  messages: AiChatMessage[],
  maxTokens: number,
  timeoutMs: number
): Promise<{ text: string; usage: AiUsage }> {
  const baseUrl = await assertSafeAiUrl(endpoint.baseUrl);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
      // A redirect could send the key and the request to a different host.
      redirect: "error",
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new AiError(
        `O modelo ${model} não respondeu em ${Math.round(timeoutMs / 1000)} s.`,
        424,
        "timeout"
      );
    }
    throw new AiError(
      "Não foi possível falar com o serviço de IA agora. Confira o endereço e tente de novo.",
      424,
      "network"
    );
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`[AI] A chave do serviço de IA foi recusada (HTTP ${response.status}).`);
    throw new AiError("O serviço de IA recusou a chave. Confira a chave nas Configurações.", 424, "auth");
  }
  if (response.status === 404) {
    throw new AiError(
      `O serviço de IA não encontrou o modelo ${model} ou esse endereço. Confira a URL e o modelo.`,
      424,
      "not_found"
    );
  }
  if (response.status === 429) {
    throw new AiError(
      `O serviço de IA está ocupado ou no limite de uso (modelo ${model}). Tente de novo em instantes.`,
      429,
      "rate_limited"
    );
  }
  if (!response.ok) {
    console.error(`[AI] O serviço de IA respondeu HTTP ${response.status} para o modelo ${model}.`);
    throw new AiError(`O modelo ${model} devolveu um erro (HTTP ${response.status}).`, 424, "upstream");
  }

  const raw = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream") || raw.trimStart().startsWith("data:")) {
    const streamed = readSseContent(raw);
    return {
      text: streamed.text,
      usage: { model: streamed.model ?? model, inputTokens: null, outputTokens: null },
    };
  }

  try {
    const body = JSON.parse(raw) as {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      usage: {
        model: body.model ?? model,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
      },
    };
  } catch {
    throw new AiError(`O modelo ${model} devolveu uma resposta fora do formato esperado.`, 424, "bad_format");
  }
}

/** Ask one model for a JSON object and validate it, giving it a second chance when the format is wrong. */
async function chatJsonOnModel<S extends z.ZodType>(
  schema: S,
  options: { system: string; user: string; maxTokens: number },
  endpoint: AiEndpoint,
  model: string,
  timeoutMs: number,
  formatRetries: number
): Promise<{ data: z.output<S>; usage: AiUsage }> {
  const messages: AiChatMessage[] = [
    { role: "system", content: options.system },
    { role: "user", content: options.user },
  ];

  for (let attempt = 0; attempt <= formatRetries; attempt++) {
    const { text, usage } = await requestCompletion(endpoint, model, messages, options.maxTokens, timeoutMs);
    try {
      const parsed = schema.safeParse(extractJsonObject(text));
      if (parsed.success) return { data: parsed.data, usage };
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
    }
    messages.push(
      { role: "assistant", content: text },
      {
        role: "user",
        content:
          "Sua resposta não seguiu o formato pedido. Responda de novo apenas com um objeto JSON válido, no formato descrito, sem texto antes nem depois.",
      }
    );
  }
  throw new AiError(`O modelo ${model} devolveu uma resposta fora do formato esperado.`, 424, "bad_format");
}

/**
 * Ask for a JSON object and validate it. When a model fails for a reason that
 * another model could avoid (no answer in time, a service error, a wrong
 * format), the next model in the list is tried, and the result says which ones
 * failed so the person can be told.
 */
export async function chatJson<S extends z.ZodType>(
  schema: S,
  options: { system: string; user: string; maxTokens?: number },
  endpoint: AiEndpoint
): Promise<AiRunResult<z.output<S>>> {
  const candidates = [endpoint.model, ...(endpoint.fallbackModels ?? []).filter((name) => name !== endpoint.model)];
  const runOptions = { system: options.system, user: options.user, maxTokens: options.maxTokens ?? 2000 };
  // With a reserve model waiting, move on at once instead of asking the same model twice.
  const formatRetries = candidates.length === 1 ? 1 : 0;
  const startedAt = Date.now();
  const failures: AiAttemptFailure[] = [];

  for (const model of candidates) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < MIN_ATTEMPT_MS) {
      failures.push({ model, reason: "timeout", message: `O tempo total acabou antes de tentar o modelo ${model}.` });
      break;
    }
    try {
      const result = await chatJsonOnModel(
        schema,
        runOptions,
        endpoint,
        model,
        Math.min(ATTEMPT_TIMEOUT_MS, remaining),
        formatRetries
      );
      return { data: result.data, usage: result.usage, modelUsed: model, failures };
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      failures.push({ model, reason: error.reason, message: error.message });
      // A refused key or an unreachable service fails the same way for every model.
      if (!isModelSpecificFailure(error.reason)) throw error;
    }
  }

  if (failures.length === 1) {
    throw new AiError(failures[0].message, 424, failures[0].reason);
  }
  const tried = failures.map((failure) => `${failure.model} (${describeFailureReason(failure.reason)})`).join(", ");
  throw new AiError(
    `Nenhum dos modelos respondeu: ${tried}. Confira o modelo nas Configurações ou tente de novo.`,
    424,
    failures[failures.length - 1]?.reason ?? "other"
  );
}

/** One sentence telling the person that a reserve model answered, and why. Null when the main model did. */
export function describeFallback(failures: AiAttemptFailure[], modelUsed: string): string | null {
  if (failures.length === 0) return null;
  const failed = failures
    .map((failure) => `${failure.model} (${describeFailureReason(failure.reason)})`)
    .join(", ");
  return `O modelo ${failed} falhou, então usamos o modelo reserva ${modelUsed}.`;
}

/** Send a tiny request to prove that the address, key and one model work together. */
export async function pingAiModel(
  endpoint: Pick<AiEndpoint, "baseUrl" | "apiKey">,
  model: string
): Promise<{ latencyMs: number; model: string }> {
  const startedAt = Date.now();
  const { usage } = await requestCompletion(
    endpoint,
    model,
    [{ role: "user", content: "Responda apenas: ok" }],
    32,
    ATTEMPT_TIMEOUT_MS
  );
  return { latencyMs: Date.now() - startedAt, model: usage.model };
}

/** Same as pingAiModel, for the endpoint's main model. */
export async function pingAiEndpoint(endpoint: AiEndpoint): Promise<{ latencyMs: number; model: string }> {
  return pingAiModel(endpoint, endpoint.model);
}

/** Model names the endpoint advertises, for suggestions. Empty when it does not list them. */
export async function listAiModels(endpoint: Pick<AiEndpoint, "baseUrl" | "apiKey">): Promise<string[]> {
  try {
    const baseUrl = await assertSafeAiUrl(endpoint.baseUrl);
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? []).flatMap((entry) => (typeof entry.id === "string" ? [entry.id] : []));
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 200);
  } catch {
    return [];
  }
}
