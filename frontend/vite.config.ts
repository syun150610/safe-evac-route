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
      // Workerを使う場合はローカルR2、FastAPI直起動の場合は
      // data/processed/tiles を同じ /tiles URLで参照する。
      '/tiles': apiTarget,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
