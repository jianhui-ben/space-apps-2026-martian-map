three.js r170 addons (npm `three@0.170.0`, MIT, see ../LICENSE), unchanged, with the
`examples/jsm/` layout kept. Fetched from `https://unpkg.com/three@0.170.0/examples/jsm/<path>`:

- `loaders/GLTFLoader.js` (imports `three` and `../utils/BufferGeometryUtils.js`)
- `utils/BufferGeometryUtils.js` (imports `three`)
- `postprocessing/Pass.js` (imports `three`)

They are the `three/addons/...` files that `../../3d-tiles-renderer/` imports. Map
`"three/addons/": "./vendor/three/addons/"` in the import map. The flat files one level up
(`CSS2DRenderer.js`, `OrbitControls.js`) are shared with the navigation lane and stay where they are.
