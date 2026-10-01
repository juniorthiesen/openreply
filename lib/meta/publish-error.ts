/**
 * Meta's code 100 covers invalid/unsupported request parameters as well as
 * some access failures. Only explicit permission codes should disable future
 * publishing for an Instagram account.
 */
export function classifyInstagramPublishError(code: number, message: string) {
  const permissionRevoked = code === 10 || code === 200;

  return {
    permissionRevoked,
    message: permissionRevoked
      ? `A Meta recusou a permissão de publicar conteúdo. Reconecte o Instagram e aprove a permissão de publicação. Detalhe: ${message}`
      : message,
  };
}
