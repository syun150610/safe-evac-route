import { opendir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { spawn } from "node:child_process";

const BUCKET = "safe-evac-route-storage";
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const CONCURRENCY = 24;
// プレフィックスごとの期待件数。**総数だけでは守れない。**
// 「kensetsu は正しく、gesuido が欠けている」状態でも合計が偶然合えば通ってしまい、
// R2にはロールバック手段が無い。gesuido は唯一の旧世代退避先なので、
// 欠けたまま投入されるのをここで止める（docs/dev/07_課題と作業計画.md の P0-5）。
// ⚠️ 生成物の枚数を変えたら、この値と docs の記載を一緒に更新すること。
const EXPECTED_ASSETS = {
  "flood/gesuido": 2_491,
  "flood/kensetsu": 6_308, // 23区+多摩の市街化区域（envelope 5,044 / 神田川 632 / 隅田川 632）
  quake: 3,
};
const PUBLIC_ROOTS = Object.keys(EXPECTED_ASSETS);
const PUBLIC_KEY = /^(?:flood\/(?:gesuido|kensetsu)\/(?:envelope|kandagawa|sumidagawa)\/(?:12|13|14|15)\/\d+\/\d+\.png|quake\/(?:building|fire|total)\.geojson)$/;
const source = process.argv[2];
const checkOnly = process.argv.includes("--check");

if (!source) {
  console.error(
    "usage: npm run tiles:upload -- /absolute/path/to/data/processed/tiles [--check]",
  );
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
const counts = {};
for (const root of PUBLIC_ROOTS) {
  counts[root] = 0;
  for await (const file of filesUnder(join(source, root))) {
    files.push(file);
    counts[root] += 1;
  }
}
files.sort();
if (files.length === 0) throw new Error(`${source}: PNGまたはGeoJSONがありません`);

// どのプレフィックスがいくつずれているかを出す。総数だけでは原因が分からない。
const mismatched = PUBLIC_ROOTS.filter((root) => counts[root] !== EXPECTED_ASSETS[root]).map(
  (root) => {
    const diff = counts[root] - EXPECTED_ASSETS[root];
    return `${root}: ${counts[root]}件（期待値 ${EXPECTED_ASSETS[root]}件 / ${diff > 0 ? "+" : ""}${diff}）`;
  },
);
if (mismatched.length > 0) {
  const total = Object.values(EXPECTED_ASSETS).reduce((a, b) => a + b, 0);
  throw new Error(
    `${source}: 件数が期待値と違います\n  ${mismatched.join("\n  ")}\n` +
      `  合計: ${files.length}件（期待値 ${total}件）`,
  );
}
const invalidKey = files.map(objectKey).find((key) => !PUBLIC_KEY.test(key));
if (invalidKey) throw new Error(`${invalidKey}: 公開対象外のパスです`);
if (checkOnly) {
  const detail = PUBLIC_ROOTS.map((root) => `${root}=${counts[root]}`).join(" ");
  console.log(`validated ${files.length} assets (no upload) / ${detail}`);
  process.exit(0);
}

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
