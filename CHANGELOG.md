# Changelog

## [1.0.0](https://github.com/khromov/simple-3d-modeling-mcp/compare/v1.0.0...v1.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* the npm package is now @khromov/simple-3d-modeling-mcp (npx -y @khromov/simple-3d-modeling-mcp); versioning restarts at 1.0.0.

### Features

* fast Manifold engine, correct previews, model facts, BOSL2 and safer exports ([8e78269](https://github.com/khromov/simple-3d-modeling-mcp/commit/8e7826975d08d08666c06d7474bcba40552ac61e))
* use OpenSCAD's official WebAssembly build ([652c13c](https://github.com/khromov/simple-3d-modeling-mcp/commit/652c13c5a7146efb086f72fac650ca6b5b2fb069))
* use OpenSCAD's official WebAssembly build ([d2700b3](https://github.com/khromov/simple-3d-modeling-mcp/commit/d2700b3ae2c4dae0e5e2ac21f05c0e016a4260d1))
* **viewer:** rebuild the browser viewer with Vite and Svelte 5 ([03a8201](https://github.com/khromov/simple-3d-modeling-mcp/commit/03a820132d7dcf20ce59736d97accd2258584cee))
* **viewer:** rebuild the browser viewer with Vite and Svelte 5 ([b20ff4d](https://github.com/khromov/simple-3d-modeling-mcp/commit/b20ff4dcdeefba9e4eb2644a09bad004cb5c2718))


### Bug Fixes

* **deps:** cap inline payloads at 2 MiB and keep SDK-style input schemas ([35ce447](https://github.com/khromov/simple-3d-modeling-mcp/commit/35ce4478e3e8cdc64342d115638fea03a6a836c8))
* **deps:** replace @modelcontextprotocol/sdk with tmcp ([282b8b8](https://github.com/khromov/simple-3d-modeling-mcp/commit/282b8b8553483db1c903396072cf92088129a8fe))
* **deps:** replace @modelcontextprotocol/sdk with tmcp, test on Bun ([d179685](https://github.com/khromov/simple-3d-modeling-mcp/commit/d179685088baef42e2f328b343ea57c2a0e957e3))
* **viewer:** address review findings on the Svelte viewer ([c6825dc](https://github.com/khromov/simple-3d-modeling-mcp/commit/c6825dc29c3a42fb09a3ad1988cc396a53b3fc84))
* **viewer:** keep the WebSocket open when downloading in Firefox ([158879c](https://github.com/khromov/simple-3d-modeling-mcp/commit/158879c152802058c67b4a68f18ce02fe307a94c))


### Build System

* publish as @khromov/simple-3d-modeling-mcp via release-please and npm OIDC ([e0a1303](https://github.com/khromov/simple-3d-modeling-mcp/commit/e0a1303b27663af2bf7f796f0596ca125e8a11b0))
