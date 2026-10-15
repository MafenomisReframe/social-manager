import { defineConfig } from "vite";

// JSX trasformato da esbuild con il runtime automatico di React:
// non serve importare React in ogni componente.
export default defineConfig({
  esbuild: { jsx: "automatic" },
});
