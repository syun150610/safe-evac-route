/** どの画面を出すかの判断だけを持つ。
 *
 * ## ログインを求める範囲
 *
 * ⚠️ **地図・経路探索・避難先探索・みんなの声の閲覧は、登録なしで使える。**
 * この用途（災害時に避難経路を調べる）で、見るために会員登録を求める理由が無い。
 * 求めるのは**自分の名前が残るもの**だけ ＝ 投稿とマイページ。
 *
 * ⚠️ **これはサーバ側の防御ではない。** バックエンドは経路・ハザード・避難所APIに
 * 認証をかけておらず、`POST /api/posts` にもかかっていない（2026-08-23時点）。
 * ここで塞いでいるのは画面の導線だけで、「ログインが要るから安全」とは言えない。
 */
export type AuthStatus = 'initializing' | 'unauthenticated' | 'authenticated'

export type Screen = 'loading' | 'login' | 'map' | 'timeline' | 'new-post' | 'mypage'

/** ログインが要る画面。**ここに足すとき以外、認証の範囲は広がらない。** */
const PRIVATE: Record<string, Extract<Screen, 'new-post' | 'mypage'>> = {
  '/posts/new': 'new-post',
  '/mypage': 'mypage',
}

const PUBLIC: Record<string, Extract<Screen, 'map' | 'timeline'>> = {
  '/timeline': 'timeline',
}

export function screenFor(path: string, status: AuthStatus): Screen {
  const priv = PRIVATE[path]
  // ⚠️ **公開画面では初期化の完了を待たない。** 待つと、未ログインの人にも
  //    毎回スピナーが出る（トークンの確認は失敗するまで数百ms かかる）
  if (priv) {
    if (status === 'initializing') return 'loading'
    return status === 'authenticated' ? priv : 'login'
  }
  return PUBLIC[path] ?? 'map'
}
