// CORS + JSON helpers shared by every API route.
// The frontend lives on another address, so the browser needs these headers.

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(), "Cache-Control": "no-store" },
  });
}

// answer for the browser's automatic "preflight" request
export function preflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
