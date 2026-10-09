import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
  build: {
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        // The XLSX export graph is precached by public/sw.js so exports
        // work offline on first use — those three chunks need stable URLs
        // (export-xlsx.js is the entry; export-xlsx-writer.js is
        // write-excel-file + fflate; chartData.js is shared with
        // ChartsSection). Everything else keeps hashed names.
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'exportService') return 'assets/export-xlsx.js';
          if (chunkInfo.name === 'universal') return 'assets/export-xlsx-writer.js';
          if (chunkInfo.name === 'chartData') return 'assets/chartData.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  }
})
