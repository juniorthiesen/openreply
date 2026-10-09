import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

const LP_COOKIE = "fisga_lp";
const LP_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const BOT_PATTERN = /bot|crawl|spider|facebookexternalhit|meta-external|slurp|preview/i;

type LpVariant = "a" | "b";

const asVariant = (value: string | null | undefined): LpVariant | null =>
  value === "a" || value === "b" ? value : null;

// Teste A/B da home: A é a página atual, B acrescenta planos e preços.
// "?lp=a" ou "?lp=b" força uma variante; robôs e revisores de link sempre veem A.
function splitHome(request: NextRequest) {
  const forced = asVariant(request.nextUrl.searchParams.get("lp"));
  const isBot = BOT_PATTERN.test(request.headers.get("user-agent") ?? "");
  const stored = asVariant(request.cookies.get(LP_COOKIE)?.value);
  const variant: LpVariant = isBot ? "a" : (forced ?? stored ?? (Math.random() < 0.5 ? "a" : "b"));

  const response =
    variant === "b"
      ? NextResponse.rewrite(new URL("/lp/b", request.url))
      : NextResponse.next();

  if (!isBot && stored !== variant) {
    response.cookies.set(LP_COOKIE, variant, {
      path: "/",
      maxAge: LP_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/") return splitHome(request);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";
  const isAuthenticated = hasSessionCookie(request);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/automations/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/login",
  ],
};
