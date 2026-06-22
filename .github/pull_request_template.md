## What & why

<!-- What does this change and why? Link any issue. -->

## Verified in

- [ ] Chromium
- [ ] WebKit / Safari
- [ ] Firefox

<!-- For visual changes: confirm specular + chromatic aberration are present in
     both Chromium and WebKit, and the lens holds ~60fps on drag. -->

## Checklist

- [ ] `pnpm typecheck && pnpm build` pass
- [ ] No new runtime dependencies
- [ ] Public API has JSDoc
- [ ] Did not regress the cross-browser invariants (see CONTRIBUTING)
