/** Meta answers code 10 with this subcode when the account cannot post trial reels. */
export const TRIAL_REELS_UNSUPPORTED_SUBCODE = 2207081;

type KnownPublishError = {
  /** A later attempt can succeed with the same file and settings. */
  retryable: boolean;
  message: string;
};

/**
 * Instagram content-publishing subcodes, translated into what the user should
 * do next. Meta's own text ("Media upload has failed with error code 2207026")
 * names the failure but never the fix, so the fix is spelled out here.
 */
const KNOWN_PUBLISH_ERRORS: Record<number, KnownPublishError> = {
  2207001: { retryable: true, message: "O Instagram teve um erro interno ao processar a mídia." },
  2207003: { retryable: true, message: "O Instagram demorou demais para baixar o arquivo." },
  2207004: { retryable: false, message: "A imagem é grande demais. Use um arquivo de até 8 MB." },
  2207005: { retryable: false, message: "Formato de imagem não suportado. Envie a imagem em JPEG." },
  2207006: { retryable: false, message: "O Instagram não encontrou a mídia. Envie o arquivo novamente." },
  2207008: { retryable: true, message: "A preparação da mídia expirou no Instagram." },
  2207009: { retryable: false, message: "Proporção não suportada. Para o feed, use entre 4:5 (vertical) e 1,91:1 (horizontal)." },
  2207010: { retryable: false, message: "A legenda é longa demais. O limite é de 2.200 caracteres, 30 hashtags e 20 menções." },
  2207020: { retryable: false, message: "A mídia expirou no Instagram. Envie o arquivo novamente." },
  2207023: { retryable: false, message: "Tipo de mídia desconhecido. Use JPEG para imagens e MP4 ou MOV para vídeos." },
  2207026: { retryable: false, message: "Formato de vídeo não suportado. Use MP4 ou MOV com H.264 e áudio AAC, até 15 minutos." },
  2207027: { retryable: true, message: "A mídia ainda não estava pronta no Instagram." },
  2207028: { retryable: false, message: "O carrossel não passou na validação do Instagram. Use de 2 a 10 itens válidos." },
  2207032: { retryable: true, message: "O Instagram não conseguiu criar a mídia." },
  2207042: { retryable: false, message: "Esta conta atingiu o limite de publicações pela API nas últimas 24 horas. Tente novamente amanhã." },
  2207050: { retryable: false, message: "A conta do Instagram está restrita ou inativa. Abra o app do Instagram e resolva os avisos da conta." },
  2207051: { retryable: false, message: "O Instagram bloqueou esta publicação por suspeita de spam. Revise a legenda e os links e tente mais tarde." },
  2207052: { retryable: true, message: "O Instagram não conseguiu baixar o arquivo." },
  2207053: { retryable: true, message: "Erro desconhecido no envio para o Instagram." },
  2207057: { retryable: false, message: "O ponto escolhido para a capa do vídeo é inválido." },
  2207078: { retryable: false, message: "Esta conta atingiu o limite de Reels de teste. Tente mais tarde ou publique como Reel normal." },
  2207081: { retryable: false, message: "Esta conta do Instagram não está habilitada pela Meta para Reels de teste. Edite o post, desmarque \"Reel de teste\" e publique como Reel normal." },
  2207082: { retryable: true, message: "O Instagram ainda está processando a mídia." },
};

/** Container status texts carry the subcode only inside the message. */
function subcodeFromText(text: string): number | undefined {
  const match = text.match(/\b(22070\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

export type PublishErrorClassification = {
  /** The subcode is one we have a specific explanation for. */
  known: boolean;
  permissionRevoked: boolean;
  retryable: boolean;
  message: string;
};

/**
 * Meta's code 100 covers invalid/unsupported request parameters as well as
 * some access failures. Only explicit permission codes should disable future
 * publishing for an Instagram account — and not when the subcode says the
 * refusal is about something else (trial reels, a restricted account).
 */
export function classifyInstagramPublishError(
  code: number,
  message: string,
  subcode?: number
): PublishErrorClassification {
  const known = KNOWN_PUBLISH_ERRORS[subcode ?? subcodeFromText(message) ?? -1];
  if (known) {
    return {
      known: true,
      permissionRevoked: false,
      retryable: known.retryable,
      message: `${known.message} Detalhe: ${message}`,
    };
  }

  const permissionRevoked = code === 10 || code === 200;
  return {
    known: false,
    permissionRevoked,
    retryable: false,
    message: permissionRevoked
      ? `A Meta recusou a permissão de publicar conteúdo. Reconecte o Instagram e aprove a permissão de publicação. Detalhe: ${message}`
      : message,
  };
}

/**
 * A container that ends in ERROR only reports a status text, sometimes with a
 * subcode inside. Translate it when we recognise the code.
 */
export function describeContainerFailure(
  status: string | undefined,
  statusCode: string | undefined
): string {
  const text = status || `A Meta não conseguiu processar o arquivo (${statusCode ?? "ERROR"}).`;
  const known = KNOWN_PUBLISH_ERRORS[subcodeFromText(text) ?? -1];
  return known ? `${known.message} Detalhe: ${text}` : text;
}
