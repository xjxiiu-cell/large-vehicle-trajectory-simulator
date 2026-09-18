import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 使用相对资源地址，使 GitHub Pages 的“用户名.github.io/仓库名/”路径可直接加载 JS、CSS 和 DWG WASM。
  base: './',
  plugins: [react()],
  // WASM 文件支持
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@mlightcad/libredwg-web'],
  },
})
