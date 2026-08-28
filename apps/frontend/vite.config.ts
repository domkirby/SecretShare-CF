import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173 },
  test: {
    // api.ts reads import.meta.env.VITE_API_BASE at module load.
    env: { VITE_API_BASE: "https://api.test.invalid" },
    environment: "node",
  },
});
