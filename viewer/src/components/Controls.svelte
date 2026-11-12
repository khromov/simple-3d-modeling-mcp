<script lang="ts">
  interface Props {
    edges: boolean;
    wireframe: boolean;
    autoRotate: boolean;
    grid: boolean;
    onreset: () => void;
  }

  let {
    edges = $bindable(),
    wireframe = $bindable(),
    autoRotate = $bindable(),
    grid = $bindable(),
    onreset,
  }: Props = $props();
</script>

<div id="controls">
  <button class="btn" onclick={onreset}>Reset view</button>
  <button class={["btn", { on: edges }]} aria-pressed={edges} onclick={() => (edges = !edges)}>Edges</button>
  <button class={["btn", { on: wireframe }]} aria-pressed={wireframe} onclick={() => (wireframe = !wireframe)}>Wireframe</button>
  <button class={["btn", { on: autoRotate }]} aria-pressed={autoRotate} onclick={() => (autoRotate = !autoRotate)}>Auto-rotate</button>
  <button class={["btn", { on: grid }]} aria-pressed={grid} onclick={() => (grid = !grid)}>Grid</button>
</div>

<style>
  #controls { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  button { padding: 5px 12px; }
  .on { color: var(--accent); border-color: var(--accent-border); }
</style>
