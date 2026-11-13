# Changelog

## [1.0.0](https://github.com/khromov/simple-3d-modeling-mcp/compare/v1.0.0...v1.0.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* an installed OpenSCAD is no longer used (OPENSCAD_PATH, OPENSCAD_ENGINE and OPENSCAD_WORK_DIR are ignored), and render's colorscheme option and AMF/PDF export are removed.
* the npm package is now @khromov/simple-3d-modeling-mcp (npx -y @khromov/simple-3d-modeling-mcp); versioning restarts at 1.0.0.

### Features

* fast Manifold engine, correct previews, model facts, BOSL2 and safer exports ([8e78269](https://github.com/khromov/simple-3d-modeling-mcp/commit/8e7826975d08d08666c06d7474bcba40552ac61e))
* remove native OpenSCAD support ([375a02f](https://github.com/khromov/simple-3d-modeling-mcp/commit/375a02f5af80721713765161a69136f15e18fa7f))
* rename to Sketchpad 3D (npm: sketchpad-3d-model-mcp) ([dedaa8e](https://github.com/khromov/simple-3d-modeling-mcp/commit/dedaa8e4e23a71ae92e1b76161aac0e5a96a56b1))
* renderer improvements: near-plane clipping, sliver performance, transparency ([1c1587f](https://github.com/khromov/simple-3d-modeling-mcp/commit/1c1587ffa92d3da17d313979705994fcba7f70b7))
* show transparent colours in previews ([aaad362](https://github.com/khromov/simple-3d-modeling-mcp/commit/aaad3624246375ed07e0f288b8409b33d0be75f0))
* use OpenSCAD's official WebAssembly build ([652c13c](https://github.com/khromov/simple-3d-modeling-mcp/commit/652c13c5a7146efb086f72fac650ca6b5b2fb069))
* use OpenSCAD's official WebAssembly build ([d2700b3](https://github.com/khromov/simple-3d-modeling-mcp/commit/d2700b3ae2c4dae0e5e2ac21f05c0e016a4260d1))
* **viewer:** middle-drag pans; view controls behind a "?" box ([12bc99b](https://github.com/khromov/simple-3d-modeling-mcp/commit/12bc99b2dac703b8a7424a3bb8eec66e859074c6))
* **viewer:** open models in slicers as 3MF, with colours ([066f574](https://github.com/khromov/simple-3d-modeling-mcp/commit/066f57481d659e49023efcbce569621e4b50eebb))
* **viewer:** read-only code view with OpenSCAD highlighting ([101bfbe](https://github.com/khromov/simple-3d-modeling-mcp/commit/101bfbefed1f48a55275d14cf42993928c356364))
* **viewer:** rebuild the browser viewer with Vite and Svelte 5 ([03a8201](https://github.com/khromov/simple-3d-modeling-mcp/commit/03a820132d7dcf20ce59736d97accd2258584cee))
* **viewer:** rebuild the browser viewer with Vite and Svelte 5 ([b20ff4d](https://github.com/khromov/simple-3d-modeling-mcp/commit/b20ff4dcdeefba9e4eb2644a09bad004cb5c2718))
* **viewer:** redesign the viewer as an architect's drawing ([856ca03](https://github.com/khromov/simple-3d-modeling-mcp/commit/856ca032fdba98b993e21da76e9fb4792099e4e7))
* **viewer:** redesign the viewer as an architect's drawing ([962986c](https://github.com/khromov/simple-3d-modeling-mcp/commit/962986cd97de2067036db1a9e9a3cec3c197a89e))


### Bug Fixes

* accept only plain decimal numbers in view strings ([f596404](https://github.com/khromov/simple-3d-modeling-mcp/commit/f596404b4c1e590e0641ff364214579138a3d54b))
* clip faces at the near plane instead of dropping them ([fbab1b9](https://github.com/khromov/simple-3d-modeling-mcp/commit/fbab1b9e2868cc392c19c8f1b4fd2d712b4d32fb))
* **deps:** cap inline payloads at 2 MiB and keep SDK-style input schemas ([35ce447](https://github.com/khromov/simple-3d-modeling-mcp/commit/35ce4478e3e8cdc64342d115638fea03a6a836c8))
* **deps:** replace @modelcontextprotocol/sdk with tmcp ([282b8b8](https://github.com/khromov/simple-3d-modeling-mcp/commit/282b8b8553483db1c903396072cf92088129a8fe))
* **deps:** replace @modelcontextprotocol/sdk with tmcp, test on Bun ([d179685](https://github.com/khromov/simple-3d-modeling-mcp/commit/d179685088baef42e2f328b343ea57c2a0e957e3))
* hint at bundled libraries when an include file is missing ([4cdc19d](https://github.com/khromov/simple-3d-modeling-mcp/commit/4cdc19d37cccc13ddabd93a52c3b887a51e8de14))
* keep dark colours readable in previews ([90371cb](https://github.com/khromov/simple-3d-modeling-mcp/commit/90371cb78973715163768d0cb65f592ea8b00125))
* keep echoed strings with newlines whole ([312ba5f](https://github.com/khromov/simple-3d-modeling-mcp/commit/312ba5fe0eb3ec436a375c98a36abd952f9430fd))
* keep the axis gizmo and multiview titles off the model ([a4c1d8e](https://github.com/khromov/simple-3d-modeling-mcp/commit/a4c1d8e273d4e88d9c5086137703fde1fbffd739))
* keep vector cameras steady near straight down ([fcd0ae1](https://github.com/khromov/simple-3d-modeling-mcp/commit/fcd0ae1ca7ccc55a1317f06ea1c8f7139e6247d3))
* let render_turntable look from below instead of upside down ([17d65fb](https://github.com/khromov/simple-3d-modeling-mcp/commit/17d65fb72dea85ee705242b32b75a52bd91143f9))
* load fonts when a bundled library calls text() ([fa3344a](https://github.com/khromov/simple-3d-modeling-mcp/commit/fa3344ada83e0d885b0094a51f5914cb06f9ed04))
* never run a job longer than OPENSCAD_TIMEOUT ([4baffc7](https://github.com/khromov/simple-3d-modeling-mcp/commit/4baffc75b71d55cdd31cb340959e116146e573a8))
* reject cameras with no direction or distance ([76904bf](https://github.com/khromov/simple-3d-modeling-mcp/commit/76904bf2b9a793d0382c4e3576d9c7f49db01dab))
* render tweaks: dark colours, overlays and camera nits ([bb7d482](https://github.com/khromov/simple-3d-modeling-mcp/commit/bb7d482cada261351686e52b50c988aa80493fc6))
* report invalid params as input errors ([38663fd](https://github.com/khromov/simple-3d-modeling-mcp/commit/38663fd6b39c1e04548000dd1243a02cc887ae05))
* stop a turntable as soon as it is too large to return ([332de40](https://github.com/khromov/simple-3d-modeling-mcp/commit/332de4065d54002d375247d65d3613e0842db6c0))
* stop outlining the facets of smooth curves ([3c64ff8](https://github.com/khromov/simple-3d-modeling-mcp/commit/3c64ff8358eb305f76d75a986a3fd6f89ae378b6))
* **viewer:** address review findings on the Svelte viewer ([c6825dc](https://github.com/khromov/simple-3d-modeling-mcp/commit/c6825dc29c3a42fb09a3ad1988cc396a53b3fc84))
* **viewer:** bolder axis arrows and a top-right legend ([ac5d1e0](https://github.com/khromov/simple-3d-modeling-mcp/commit/ac5d1e02b465c451e7a55030471a68b12cfb66c7))
* **viewer:** keep the WebSocket open when downloading in Firefox ([158879c](https://github.com/khromov/simple-3d-modeling-mcp/commit/158879c152802058c67b4a68f18ce02fe307a94c))
* **viewer:** no hairline gap at the edge of colour swatches ([a9f3f82](https://github.com/khromov/simple-3d-modeling-mcp/commit/a9f3f82eda9868479ef0f0f37b4dc30860edb2d3))
* **viewer:** polish the redesigned viewer ([7121b3f](https://github.com/khromov/simple-3d-modeling-mcp/commit/7121b3fafd901f713017219e9f35e566f2a57aba))
* **viewer:** raise the model in the viewport, hints under the axis key ([b5eb052](https://github.com/khromov/simple-3d-modeling-mcp/commit/b5eb05215a98b9c133e3416f330f7c469467c89d))
* **viewer:** slightly darker blueprint blue in dark mode ([e0ec4f4](https://github.com/khromov/simple-3d-modeling-mcp/commit/e0ec4f40a59ed14ed4d1a9603f150f6539413fc2))


### Performance Improvements

* rasterise only the part of each row a triangle covers ([2be6592](https://github.com/khromov/simple-3d-modeling-mcp/commit/2be659229501fdb1cd5200ac3bf8cd73faca8dd5))


### Build System

* publish as @khromov/simple-3d-modeling-mcp via release-please and npm OIDC ([e0a1303](https://github.com/khromov/simple-3d-modeling-mcp/commit/e0a1303b27663af2bf7f796f0596ca125e8a11b0))
