import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// test の設定も書くので vitest 側の defineConfig を使う
import { defineConfig } from 'vitest/config'

// 開発時にAPIを誰が受けるか。既定は Worker（本番と同じ経路）。
// ⚠️ Worker を立てずに FastAPI を直接叩きたいときは API_TARGET を渡す:
//     API_TARGET=http://localhost:8000 npm run dev
const apiTarget = process.env.API_TARGET ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': apiTarget,
      // ⚠️ **暫定。** ハザードのタイルは開発中だけ FastAPI が配っている。
      //    Worker は /api/* しか Container へ回さないので、本番はここを通らない。
      //    R2 + Worker から配るように変えるのは別PR（タイルURLは /api/hazards が
      //    配るので、切り替えても表示側は無改修）
      '/tiles': apiTarget,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
