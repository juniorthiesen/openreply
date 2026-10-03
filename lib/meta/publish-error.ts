/** Meta answers code 10 with this subcode when the account cannot post trial reels. */
export const TRIAL_REELS_UNSUPPORTED_SUBCODE = 2207081;

/**
 * Meta's code 100 covers invalid/unsupported request parameters as well as
 * some access failures. Only explicit permission codes should disable future
 * publishing for an Instagram account — and not when the subcode says the
 * refusal is about trial reels, which the account simply isn't eligible for.
 */
export function classifyInstagramPublishError(
  code: number,
  message: string,
  subcode?: number
) {
  if (subcode === TRIAL_REELS_UNSUPPORTED_SUBCODE) {
    return {
      permissionRevoked: false,
      message: `Esta conta do Instagram não está habilitada pela Meta para Reels de teste. Edite o post, desmarque "Reel de teste" e publique como Reel normal. Detalhe: ${message}`,
    };
  }

  const permissionRevoked = code === 10 || code === 200;

  return {
    permissionRevoked,
    message: permissionRevoked
      ? `A Meta recusou a permissão de publicar conteúdo. Reconecte o Instagram e aprove a permissão de publicação. Detalhe: ${message}`
      : message,
  };
}
