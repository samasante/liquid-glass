# Browser support

`liquid-glass` applies its effect as `filter: url(#…)` on the wrapped element
(not `backdrop-filter: url()`, which is Chromium-only). That, plus the WebKit
hardening below, is what lets the refraction render across engines.

| Engine | Displacement | Chromatic aberration | Specular | Notes |
|---|---|---|---|---|
| **Chromium** (Chrome, Edge, Brave, …) | ✅ | ✅ | ✅ | Full fidelity; opt into `filterResolution={2}` for crisper edges. |
| **WebKit** (Safari, iOS) | ✅ | ✅ | ✅ | Runs at 1× (see below); identical look, no supersample. |
| **Firefox** (Gecko) | ✅ | ✅ | ✅ | Works via `filter: url()`. |

Verified with Playwright against **Chromium** and **WebKit** (WebKit ≈ Safari).

## The Safari fixes (built in, nothing to configure)

Safari is the reason most liquid-glass libraries give up on cross-browser. The
ones that work in WebKit are handled internally:

1. **No supersampling in WebKit.** `filterResolution > 1` renders the filter
   into a larger raster for crisp edges in Chromium. In Safari a 2× source
   pushes the filter over WebKit's source-graphic **size ceiling**, past which
   it silently drops the costlier passes (chroma + specular) while the core
   bend survives. So supersampling is Chromium-only; Safari runs at 1×.
2. **Map regeneration is debounced and shape-triggered.** The displacement map
   is regenerated only when the lens changes **shape**, never when it moves. If
   the `feImage` href churned mid-drag, Safari would throttle the costly passes
   and the shine/chroma would vanish until you stopped. The live size/squash is
   carried by the subregion stretch every frame instead.
3. **Filter id is version-bumped per update.** WebKit caches filter output by
   id; bumping the id (and re-pointing `style.filter`) each geometry change
   keeps the lens live instead of freezing.
4. **Specular sampled from the raw map in Safari.** WebKit's `feComposite`
   ordering differs, so the specular mask reads from the pre-composite map.

## Known limitations

- **Very wide panels** (a dock-style bar) shouldn't use a single stretched
  displacement lens, because it blooms an oval. Use a frost-only treatment for
  those and reserve the lens for content-sized elements.
- **SVG filters are GPU-bound.** Very large lenses or many simultaneous
  instances can cost frames; keep lenses content-sized and prefer one or a few.
- `backdrop-filter: url()` (refracting arbitrary content *behind* a fixed
  panel) is unsupported in WebKit. This library refracts the DOM you **wrap**,
  which is the path that works everywhere.
