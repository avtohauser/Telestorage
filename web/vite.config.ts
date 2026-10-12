import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Для локальной разработки: фронт на :5173, API на :8080
    proxy: { "/api": "http://localhost:8080", "/s": "http://localhost:8080" },
  },
});
