import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const FLOOD_KEYS = [
  "flood/gesuido/envelope/12/3635/1611.png",
  "flood/kensetsu/envelope/12/3635/1611.png",
];
const KEYS = [...FLOOD_KEYS, "quake/total.geojson"];

afterEach(async () => {
  await env.STORAGE.delete(KEYS);
});

describe("R2 tile delivery", () => {
  it.each(FLOOD_KEYS)("streams %s with cache and content headers", async (key) => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await env.STORAGE.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });

    const response = await SELF.fetch(`https://example.com/tiles/${key}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
    expect(response.headers.get("etag")).toMatch(/^".+"$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("supports HEAD and conditional requests", async () => {
    await env.STORAGE.put(KEYS[2], '{"type":"FeatureCollection","features":[]}');

    const head = await SELF.fetch(`https://example.com/tiles/${KEYS[2]}`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("application/geo+json; charset=utf-8");
    expect(await head.text()).toBe("");

    const conditional = await SELF.fetch(`https://example.com/tiles/${KEYS[2]}`, {
      method: "HEAD",
      headers: { "if-none-match": head.headers.get("etag") ?? "" },
    });
    expect(conditional.status).toBe(304);
  });

  it("does not expose arbitrary R2 objects", async () => {
    await env.STORAGE.put("private.txt", "secret");

    const invalid = await SELF.fetch("https://example.com/tiles/private.txt");
    const traversal = await SELF.fetch(
      "https://example.com/tiles/flood/kensetsu/envelope/12/3635/../private.txt",
    );
    const unknownProfile = await SELF.fetch(
      "https://example.com/tiles/flood/unknown/envelope/12/3635/1611.png",
    );
    const method = await SELF.fetch(`https://example.com/tiles/${KEYS[0]}`, {
      method: "POST",
    });

    expect(invalid.status).toBe(404);
    expect(traversal.status).toBe(404);
    expect(unknownProfile.status).toBe(404);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, HEAD");
    await env.STORAGE.delete("private.txt");
  });
});
