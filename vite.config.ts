import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("pdfjs-dist")) return "pdf-viewer";
          if (id.includes("monaco-editor") || id.includes("@monaco-editor")) return "editor-core";
          if (id.includes("react") || id.includes("react-dom")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
