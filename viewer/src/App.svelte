<script lang="ts">
  import Appearance from "./components/Appearance.svelte";
  import Dimensions from "./components/Dimensions.svelte";
  import Export from "./components/Export.svelte";
  import History from "./components/History.svelte";
  import Section from "./components/Section.svelte";
  import Viewport from "./components/Viewport.svelte";
  import { ViewerConnection } from "./lib/connection.svelte.js";
  import { modelTitle } from "./lib/format.js";
  import { decodeViewerMesh, type ViewerMesh } from "./lib/mesh.js";
  import type { ModelUpdate } from "./lib/protocol.js";

  let model = $state.raw<{ info: ModelUpdate; mesh: ViewerMesh } | null>(null);
  let dark = $state(true);
  let modelColor = $state("#ff8c00");

  // Only the most recent update is shown, even if an older mesh download finishes later.
  let latestUpdate = 0;
  async function showUpdate(info: ModelUpdate) {
    const request = ++latestUpdate;
    try {
      const res = await fetch(`/mesh/${info.version}`);
      if (!res.ok) return;
      const mesh = decodeViewerMesh(await res.arrayBuffer());
      if (request === latestUpdate) model = { info, mesh };
    } catch (err) {
      console.error(`Could not load model v${info.version}`, err);
    }
  }

  const connection = new ViewerConnection(showUpdate);
  $effect(() => {
    connection.connect();
    return () => connection.close();
  });

  $effect(() => {
    document.body.classList.toggle("light", !dark);
  });
</script>

<Viewport mesh={model?.mesh ?? null} status={connection.status} {dark} {modelColor} />

<div id="sidebar">
  <Section title="Model">
    <div id="title">{model ? modelTitle(model.info) : "—"}</div>
  </Section>
  <Dimensions model={model?.info ?? null} />
  <History entries={connection.history} active={model?.info.version} onselect={(version) => connection.requestModel(version)} />
  <Appearance bind:dark bind:color={modelColor} />
  {#if model}
    <Export version={model.info.version} />
  {/if}
</div>

<style>
  #sidebar { width: 250px; background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
  #title { font-size: 13px; color: var(--text); font-weight: 600; word-break: break-word; }
</style>
