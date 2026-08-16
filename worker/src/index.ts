import { Container, getContainer } from "@cloudflare/containers";

export { ContainerProxy } from "@cloudflare/containers";

/** Cloudflare Containersで管理するFastAPIアプリケーション。 */
export class FastAPIContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "5m";
}

FastAPIContainer.outboundByHost = {
  // この仮想ホストはContainer内からのみ到達できる。Cloudflareの認証情報と
  // D1 BindingをPythonアプリケーションへ渡さず、Worker側に閉じ込める。
  "d1.internal": async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return Response.json({ detail: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname !== "/health") {
      return Response.json({ detail: "Not found" }, { status: 404 });
    }

    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

      if (row?.ok !== 1) {
        return Response.json({ detail: "D1 is unavailable" }, { status: 503 });
      }

      return Response.json({ status: "ok", result: row.ok });
    } catch {
      return Response.json({ detail: "D1 is unavailable" }, { status: 503 });
    }
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    // /api配下はすべてFastAPIへ転送するため、バックエンドにエンドポイントを
    // 追加してもWorker側のルーティングを追記する必要はない。
    if (pathname.startsWith("/api/")) {
      const container = getContainer(env.FASTAPI_CONTAINER);
      return container.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
