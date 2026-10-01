import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(`editor-${new Date().toISOString()}`) },
  build: { outDir: fileURLToPath(new URL("../dist/editor", import.meta.url)), emptyOutDir: true },
});
