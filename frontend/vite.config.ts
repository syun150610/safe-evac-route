import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// test の設定も書くので vitest 側の defineConfig を使う
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      // ⚠️ **暫定。** ハザードのタイルは開発中だけ FastAPI が配っている。
      //    Worker は /api/* しか Container へ回さないので、本番はここを通らない。
      //    R2 + Worker から配るように変えるのは別PR（タイルURLは /api/hazards が
      //    配るので、切り替えても表示側は無改修）
      '/tiles': 'http://localhost:8200',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
