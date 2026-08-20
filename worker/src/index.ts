import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

import { handleD1Request } from "./bindings/d1";
import { handleR2Request } from "./bindings/r2";
import { handleTileRequest } from "./tiles";

export { ContainerProxy } from "@cloudflare/containers";

/** Cloudflare Containersで管理するFastAPIアプリケーション。 */
export class FastAPIContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "5m";
  envVars = {
    HAZARD_DATA_PROFILE: env.HAZARD_DATA_PROFILE,
  };
}

FastAPIContainer.outboundByHost = {
  // この仮想ホストはContainer内からのみ到達できる。Cloudflareの認証情報と
  // D1 BindingをPythonアプリケーションへ渡さず、Worker側に閉じ込める。
  "d1.internal": handleD1Request,
  // R2もD1と同様に、認証情報をContainerへ渡さずBinding APIで操作する。
  "r2.internal": handleR2Request,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/tiles/")) {
      return handleTileRequest(request, env, ctx);
    }

    // /api配下はすべてFastAPIへ転送するため、バックエンドにエンドポイントを
    // 追加してもWorker側のルーティングを追記する必要はない。
    if (pathname.startsWith("/api/")) {
      const container = getContainer(env.FASTAPI_CONTAINER);
      return container.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
