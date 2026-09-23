import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 15321,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  build: {
    target: "es2021",
  },
});
