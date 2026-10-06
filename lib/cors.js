// CORS + JSON helpers shared by every API route.
// The frontend lives on another address, so the browser needs these headers.
// ALLOWED_ORIGIN (wrangler.toml) is a comma-separated list of allowed sites, or "*".

export function corsHeaders(request) {
  const list = (process.env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request && request.headers.get("origin");

  let allow;
  if (list.includes("*")) allow = "*";
  else if (origin && list.includes(origin)) allow = origin; // echo the matching site
  else allow = list[0];

  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(data, status = 200, request) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

// answer for the browser's automatic "preflight" request
export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
