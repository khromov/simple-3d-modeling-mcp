<script lang="ts">
  import type { ConnectionStatus } from "../lib/connection.svelte.js";
  import type { ViewerMesh } from "../lib/mesh.js";
  import { ViewerScene } from "../lib/scene.js";
  import Controls from "./Controls.svelte";

  interface Props {
    /** The model to show; null until the first one arrives. */
    mesh: ViewerMesh | null;
    status: ConnectionStatus;
    dark: boolean;
    modelColor: string;
  }

  let { mesh, status, dark, modelColor }: Props = $props();

  const STATUS_TEXT: Record<ConnectionStatus, string> = {
    connecting: "● Connecting…",
    connected: "● Connected",
    disconnected: "● Disconnected — retrying",
  };

  let edges = $state(true);
  let wireframe = $state(false);
  let autoRotate = $state(false);
  let grid = $state(true);

  const scene = new ViewerScene();
  $effect(() => () => scene.dispose());

  $effect(() => scene.setTheme(dark));
  $effect(() => scene.setModelColor(modelColor));
  $effect(() => scene.setEdges(edges));
  $effect(() => scene.setWireframe(wireframe));
  $effect(() => scene.setAutoRotate(autoRotate));
  $effect(() => scene.setGrid(grid));
  $effect(() => {
    if (mesh) scene.load(mesh);
  });
</script>

<div id="viewport" {@attach (container) => scene.mount(container)}>
  <div id="hint">Drag to rotate · Scroll to zoom · Right-drag to pan</div>
  <div id="status" class={{ off: status === "disconnected" }}>{STATUS_TEXT[status]}</div>
  {#if mesh}
    <Controls bind:edges bind:wireframe bind:autoRotate bind:grid onreset={() => scene.resetView()} />
  {:else}
    <div id="empty">Waiting for a model — render something from your AI assistant.</div>
  {/if}
</div>

<style>
  #viewport { flex: 1; position: relative; min-width: 0; }
  #status { position: absolute; top: 8px; right: 10px; font-size: 11px; color: #4aff9f; }
  #status.off { color: #ff4a4a; }
  #hint { position: absolute; top: 8px; left: 10px; color: var(--muted); font-size: 11px; pointer-events: none; }
  #empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 14px; }
</style>
