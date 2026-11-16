NASA-AMMOS 3d-tiles-renderer 0.5.4 (npm `3d-tiles-renderer@0.5.4`, Apache-2.0, see LICENSE).

From https://registry.npmjs.org/3d-tiles-renderer/-/3d-tiles-renderer-0.5.4.tgz
(sha1 7977e54eb0d8a5f6050e4a3a1e698c40eee94517, matching the registry's `dist.shasum`), unchanged:

- `build/index.three.js` (`exports["./three"]`) and `build/index.three-plugins.js`
  (`exports["./three/plugins"]`), plus the chunks they import relatively:
  `renderer-SRMU5zhW.js`, `renderer-k6QvS8mu.js`, `plugins-CxolAqBM.js`, `plugins-CNRzAo_d.js`.
  Source maps are not copied, so the `sourceMappingURL` comments point at missing files.

Bare imports, resolved by the page's import map:

- `three` -> `../three/three.module.js` (r170)
- `three/addons/loaders/GLTFLoader.js`, `three/addons/utils/BufferGeometryUtils.js`,
  `three/addons/postprocessing/Pass.js` -> `../three/addons/` (see the README there)
- `@mapbox/vector-tile`, `pbf`, `pmtiles` (dynamic `import()` for the MVT and PMTiles overlays only)
  -> `not-vendored.js`, which throws

No package scripts were run.
