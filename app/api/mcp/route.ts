import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticateApiToken } from "@/lib/mcp/tokens";

// Reports read live from Instagram and can take a while on larger accounts.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonRpcError(status: number, code: number, message: string, headers: HeadersInit = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/**
 * MCP over Streamable HTTP, stateless: every request authenticates on its own
 * token and gets a fresh server, so nothing is kept between calls and nothing
 * depends on which instance answers.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiToken(request.headers.get("authorization"));
  if (!auth) {
    return jsonRpcError(401, -32001, "Missing or invalid token.", {
      "WWW-Authenticate": 'Bearer realm="fisga-mcp"',
    });
  }

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    // The response is already built (JSON mode), so the server can go.
    void server.close().catch(() => {});
  }
}

// Stateless mode has no server-initiated stream and no session to end.
function methodNotAllowed() {
  return jsonRpcError(405, -32000, "Method not allowed.", { Allow: "POST" });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
