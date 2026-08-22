// wrangler secret put JWT_SECRET_KEY で登録するシークレットの型宣言。
// worker-configuration.d.ts は `wrangler types` で自動生成されるため、
// シークレットをここで分離管理する。
// 将来 `wrangler types` がシークレットを出力するようになった場合は
// このファイルの該当行を削除すること（宣言マージのため実害はないが混乱を防ぐため）。

// cloudflare:workers の `env` は Cloudflare.Env 名前空間を参照するため両方に宣言する
interface Env {
  JWT_SECRET_KEY: string;
}
declare namespace Cloudflare {
  interface Env {
    JWT_SECRET_KEY: string;
  }
}
