import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 서버가 붙을 API 주소(기본 http://localhost:8787). 여러 개를 동시에 띄울 때 JUSIK_API로 바꾼다
const api = process.env.JUSIK_API ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": api },
  },
});
