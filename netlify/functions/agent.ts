import agentHandler from "../../api/agent";

// Netlify Function (v2 format: Fetch Request/Response)
// Adapts Fetch Request -> Node-like req/res that api/agent.ts expects,
// then converts the handler's res calls back into a Fetch Response.

export default async function handler(request: Request, context: any) {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });

  let body: any = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  // mock Node req
  const req: any = {
    method: request.method,
    url: request.url,
    query,
    headers,
    body,
  };

  // mock Node res that accumulates status/headers/body
  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  let payload: any = null;
  let ended = false;

  const res: any = {
    status(code: number) { statusCode = code; return res; },
    setHeader(k: string, v: string) { resHeaders[k] = String(v); return res; },
    getHeader(k: string) { return resHeaders[k.toLowerCase()]; },
    json(obj: any) { payload = JSON.stringify(obj); if (!resHeaders["content-type"]) resHeaders["content-type"] = "application/json"; ended = true; return res; },
    send(obj: any) {
      if (typeof obj === "string") payload = obj;
      else payload = JSON.stringify(obj);
      ended = true; return res;
    },
    end(data?: any) { if (data) payload = data; ended = true; },
    statusCode,
  };

  await agentHandler(req, res);

  // wait a tick if handler is async and hasn't ended synchronously
  if (!ended) {
    await new Promise((r) => setTimeout(r, 50));
  }

  return new Response(payload ?? "", {
    status: statusCode,
    headers: resHeaders,
  });
}
