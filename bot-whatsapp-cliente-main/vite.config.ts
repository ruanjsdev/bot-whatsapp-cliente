import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname, "src/desktop/renderer"),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist/desktop/renderer"),
    emptyOutDir: true,
    rollupOptions: {}
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
