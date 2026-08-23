const TILE_PREFIX = "/tiles/";
// ⚠️ **ズームの範囲はここも含めて4箇所を揃えること。**
//   backend/prep/tile_render/render.py  ZOOMS（焼く範囲）
//   backend/app/services/hazards/catalog.py  FLOOD_MINZ / FLOOD_MAXZ（配るURLのzoom）
//   frontend/src/map/EvacRouteMap.tsx  FLOOD_ZOOM（地図に載せる範囲）
//   ここ（R2から出してよいキーの許可リスト）
// ⚠️ **ここだけ古いと、R2に入れても404になる。**（2026-08-24に実際に踏んだ）
const FLOOD_TILE =
  /^flood\/(?:gesuido|kensetsu)\/(?:envelope|kandagawa|sumidagawa)\/(?:1[0-5])\/\d+\/\d+\.png$/;
const QUAKE_VECTOR = /^quake\/(?:building|fire|total)\.geojson$/;
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

function tileKey(pathname: string): string | null {
  if (!pathname.startsWith(TILE_PREFIX)) return null;
  const key = pathname.slice(TILE_PREFIX.length);
  return FLOOD_TILE.test(key) || QUAKE_VECTOR.test(key) ? key : null;
}

function responseHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) {
    headers.set(
      "content-type",
      object.key.endsWith(".png") ? "image/png" : "application/geo+json; charset=utf-8",
    );
  }
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function isNotModified(request: Request, object: R2Object): boolean {
  return request.headers.get("if-none-match") === object.httpEtag;
}

function notFound(): Response {
  return Response.json({ detail: "Tile not found" }, { status: 404 });
}

/** R2に置いた浸水タイルと地震GeoJSONを同一オリジンの /tiles 配下で配信する。 */
export async function handleTileRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { detail: "Method not allowed" },
      { status: 405, headers: { allow: "GET, HEAD" } },
    );
  }

  const key = tileKey(new URL(request.url).pathname);
  if (key === null) return notFound();

  try {
    if (request.method === "HEAD") {
      const object = await env.STORAGE.head(key);
      if (object === null) return notFound();
      const headers = responseHeaders(object);
      return new Response(null, {
        status: isNotModified(request, object) ? 304 : 200,
        headers,
      });
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached !== undefined) {
      const etag = cached.headers.get("etag");
      if (etag !== null && request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: cached.headers });
      }
      return cached;
    }

    const object = await env.STORAGE.get(key);
    if (object === null) return notFound();
    const headers = responseHeaders(object);
    if (isNotModified(request, object)) {
      return new Response(null, { status: 304, headers });
    }

    const response = new Response(object.body, { headers });
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "R2 tile delivery failed",
        key,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ detail: "Tile storage is unavailable" }, { status: 503 });
  }
}
