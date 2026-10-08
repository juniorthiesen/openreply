/**
 * Sign-in email in the Fisga brand (redesign/Brandbook-html): paper background,
 * white card, the hook mark, Fisga-red button. Email clients ignore <style> and
 * web fonts unevenly, so everything is inline and table-based, and the fonts
 * fall back to Arial.
 */

const COLORS = {
  ink: "#16181D",
  fisga: "#C23E17",
  paper: "#F6F4EF",
  line: "#E2DDD1",
  stone: "#5E6068",
  white: "#FFFFFF",
};

const DISPLAY_FONT = "'Bricolage Grotesque', Arial, Helvetica, sans-serif";
const BODY_FONT = "Geist, Arial, Helvetica, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'Courier New', monospace";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMagicLinkEmail({ url }: { url: string }) {
  const { origin, host } = new URL(url);
  const link = escapeHtml(url);
  // The mark is a PNG served by the app itself: most clients don't render SVG.
  const markSrc = escapeHtml(`${origin}/email/fisga-mark.png`);

  const subject = "Seu link para entrar na Fisga";

  const text = [
    "Seu link para entrar na Fisga chegou.",
    "",
    "Abra o link abaixo para entrar. Ele vale por 24 horas e só pode ser usado uma vez:",
    url,
    "",
    "Não pediu este acesso? Pode ignorar este e-mail: ninguém entra na sua conta sem abrir o link.",
    "",
    `Fisga · ${host}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Geist:wght@400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${COLORS.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Clique para entrar na Fisga. O link vale por 24 horas.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.paper};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;"><img src="${markSrc}" width="40" height="40" alt="" style="display:block;border:0;border-radius:11px;"></td>
                <td style="vertical-align:middle;padding-left:10px;font-family:${DISPLAY_FONT};font-size:26px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">Fisga</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${COLORS.white};border:1px solid ${COLORS.line};border-radius:20px;padding:36px 32px;">
            <h1 style="margin:0;font-family:${DISPLAY_FONT};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">Seu link de acesso chegou</h1>
            <p style="margin:14px 0 0;font-family:${BODY_FONT};font-size:16px;line-height:1.5;color:${COLORS.ink};">Clique no botão para entrar na Fisga. O link vale por 24 horas e só pode ser usado uma vez.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
              <tr>
                <td style="border-radius:10px;background:${COLORS.fisga};">
                  <a href="${link}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${BODY_FONT};font-size:15px;font-weight:600;color:${COLORS.white};text-decoration:none;border-radius:10px;">Entrar na Fisga</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${COLORS.stone};">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
            <p style="margin:6px 0 0;font-family:${MONO_FONT};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${link}" target="_blank" style="color:${COLORS.fisga};text-decoration:none;">${link}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 4px 0;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${COLORS.stone};">
            Não pediu este acesso? Pode ignorar este e-mail: ninguém entra na sua conta sem abrir o link.
          </td>
        </tr>
        <tr>
          <td style="padding:18px 4px 0;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${COLORS.stone};">
            <strong style="color:${COLORS.ink};">Fisga</strong> · Comentou, recebeu. · <a href="${escapeHtml(origin)}/privacy" style="color:${COLORS.stone};">Privacidade</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
