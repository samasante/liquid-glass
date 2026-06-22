import { defineConfig } from "tsup";

/**
 * Library build → `dist/` as ESM + `.d.ts`.
 *
 *   pnpm build   one-shot dist
 *   pnpm dev     tsup --watch (linked consumers HMR on save)
 *
 * The package is headless and ships NO CSS (any required styles are inlined on
 * the elements), so there is no `injectStyle`. react / react-dom are peers the
 * consumer provides; everything else is bundled. Zero runtime dependencies.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
});
