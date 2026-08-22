// wrangler secret put JWT_SECRET_KEY で登録するシークレット。
// worker-configuration.d.ts は自動生成のため、シークレットの型はここで宣言する。
interface Env {
  JWT_SECRET_KEY: string;
}
