import { opendir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { spawn } from "node:child_process";

const BUCKET = "safe-evac-route-storage";
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const CONCURRENCY = 24;
const EXPECTED_ASSETS = 2_494;
const PUBLIC_KEY = /^(?:flood\/(?:envelope|kandagawa|sumidagawa)\/(?:12|13|14|15)\/\d+\/\d+\.png|quake\/(?:building|fire|total)\.geojson)$/;
const source = process.argv[2];

if (!source) {
  console.error("usage: npm run tiles:upload -- /absolute/path/to/tiles");
  process.exit(2);
}

async function* filesUnder(directory) {
  for await (const entry of await opendir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path);
    else if (entry.isFile() && [".png", ".geojson"].includes(extname(entry.name))) yield path;
  }
}

function objectKey(file) {
  return relative(source, file).split(sep).join("/");
}

function contentType(file) {
  return extname(file) === ".png" ? "image/png" : "application/geo+json; charset=utf-8";
}

function upload(file) {
  const key = objectKey(file);
  const wrangler = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  const child = spawn(
    wrangler,
    [
      "r2",
      "object",
      "put",
      `${BUCKET}/${key}`,
      "--file",
      file,
      "--content-type",
      contentType(file),
      "--cache-control",
      CACHE_CONTROL,
      "--remote",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let error = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(key);
      else reject(new Error(`${key}: wrangler exited ${code}\n${error}`));
    });
  });
}

const files = [];
for await (const file of filesUnder(source)) files.push(file);
files.sort();
if (files.length === 0) throw new Error(`${source}: PNGまたはGeoJSONがありません`);
if (files.length !== EXPECTED_ASSETS) {
  throw new Error(`${source}: ${files.length}件（期待値 ${EXPECTED_ASSETS}件）`);
}
const invalidKey = files.map(objectKey).find((key) => !PUBLIC_KEY.test(key));
if (invalidKey) throw new Error(`${invalidKey}: 公開対象外のパスです`);

let next = 0;
let completed = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    await upload(file);
    completed += 1;
    if (completed % 100 === 0 || completed === files.length) {
      console.log(`uploaded ${completed}/${files.length}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));
