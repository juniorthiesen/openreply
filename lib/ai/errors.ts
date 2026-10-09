/** Why a call to the AI service failed, so the app can tell the person and decide whether another model could help. */
export type AiFailureReason =
  | "timeout"
  | "network"
  | "auth"
  | "not_found"
  | "rate_limited"
  | "upstream"
  | "bad_format"
  | "other";

/**
 * An error whose message is safe to show to the user (Portuguese).
 *
 * The default status is 424, not 502/503/504: the app sits behind a CDN that
 * replaces those with its own error page, and the person then never sees the
 * real reason.
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number = 424,
    readonly reason: AiFailureReason = "other"
  ) {
    super(message);
    this.name = "AiError";
  }
}

const REASON_TEXT: Record<AiFailureReason, string> = {
  timeout: "não respondeu a tempo",
  network: "não foi possível conectar",
  auth: "a chave foi recusada",
  not_found: "modelo ou endereço não encontrado",
  rate_limited: "serviço ocupado ou no limite de uso",
  upstream: "erro no serviço de IA",
  bad_format: "resposta fora do formato esperado",
  other: "erro inesperado",
};

/** Short Portuguese description of a failure reason. */
export function describeFailureReason(reason: AiFailureReason): string {
  return REASON_TEXT[reason];
}

/** Whether trying a different model on the same service could plausibly work. */
export function isModelSpecificFailure(reason: AiFailureReason): boolean {
  // A refused key or an unreachable service fails the same way for every model.
  return reason !== "auth" && reason !== "network";
}
