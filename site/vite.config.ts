import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Dev/landing harness. The package is aliased to its live source so the site
// (and the recipes in ../examples) exercise the real public entry point with
// HMR — exactly what a consumer gets from `@samasante/liquid-glass`.
const pkgEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

export default defineConfig({
  // Tailwind is for the SITE only (examples/playground), so it's easy to test
  // styled glass with utility classes. It is NOT a dependency of the library —
  // `@samasante/liquid-glass` reads computed styles, so it works with any CSS.
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@samasante/liquid-glass": pkgEntry,
    },
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", port: 4178 },
  preview: { host: "127.0.0.1", port: 4178 },
});
