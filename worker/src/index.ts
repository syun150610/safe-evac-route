import { Container, getContainer } from "@cloudflare/containers";

export class FastAPIContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "5m";
}

export interface Env {
  FASTAPI_CONTAINER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.FASTAPI_CONTAINER);
    return container.fetch(request);
  },
};
