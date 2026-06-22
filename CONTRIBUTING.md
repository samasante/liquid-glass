# Contributing

Thanks for helping make `liquid-glass` better. The bar is simple: keep it
**headless, tiny, zero-dependency, and cross-browser**.

## Setup

```bash
pnpm install          # package deps
pnpm build            # emits dist (ESM + .d.ts)
pnpm typecheck        # tsc --noEmit

cd site
pnpm install
pnpm dev              # ?view=playground (default) | examples | docs
```

The `site/` harness aliases `liquidglass` to the live source, so
edits to `src/` hot-reload. Recipes live in `examples/` and import only from
the public entry point.

## The non-negotiables

- **Headless.** `<Glass>` stays content-agnostic — no styled chrome. Finished
  widgets are copy-paste recipes in `examples/`, never package exports.
- **Zero runtime dependencies.** React is the only peer. Don't add deps.
- **Cross-browser, always.** Every visual change must be verified in **both
  Chromium and WebKit** (WebKit ≈ Safari). The known invariants in
  [`src/Glass.tsx`](./src/Glass.tsx) (1×-in-WebKit supersample gate, shape-only
  debounced map regen, per-update filter-id bump, specular-from-raw in Safari)
  were each a hard bug — don't regress them. See [`BROWSERS.md`](./BROWSERS.md).
- **SSR-safe.** Guard `navigator`/`document`; resolve browser checks on mount.

## Verifying in WebKit

Visual changes are checked against real WebKit with Playwright. With the dev
server running, drive `playwright-core` against the cached browsers (Chromium
headless shell + WebKit) and diff the lens (switch/slider expanded, the
playground lens dragging) across engines. A change is "done" only when specular
+ chromatic aberration are present in **both** engines and the lens holds 60fps
on drag.

## PRs

- Keep diffs focused; match the surrounding style.
- Add JSDoc to anything public.
- `pnpm typecheck && pnpm build` must pass (CI runs both, plus the recipe/site
  typecheck and the landing build).
- Describe what you verified in which browsers.
