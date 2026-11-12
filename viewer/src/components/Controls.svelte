<script lang="ts">
  import Box from "@lucide/svelte/icons/box";
  import Focus from "@lucide/svelte/icons/focus";
  import Grid3x3 from "@lucide/svelte/icons/grid-3x3";
  import Rotate3d from "@lucide/svelte/icons/rotate-3d";
  import SquareDashed from "@lucide/svelte/icons/square-dashed";

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

  const ICON = { size: 18, strokeWidth: 2.25 };
</script>

<div class="toolbar" role="toolbar" aria-label="View">
  <button class="tool" onclick={onreset} title="Frame the model">
    <Focus {...ICON} /><span>Reset view</span>
  </button>
  <span class="divider" aria-hidden="true"></span>
  <button class={["tool", { on: edges }]} aria-pressed={edges} onclick={() => (edges = !edges)} title="Outline sharp edges">
    <Box {...ICON} /><span>Edges</span>
  </button>
  <button class={["tool", { on: wireframe }]} aria-pressed={wireframe} onclick={() => (wireframe = !wireframe)} title="Show the triangle mesh">
    <SquareDashed {...ICON} /><span>Wireframe</span>
  </button>
  <button class={["tool", { on: grid }]} aria-pressed={grid} onclick={() => (grid = !grid)} title="Show the grid and axes">
    <Grid3x3 {...ICON} /><span>Grid</span>
  </button>
  <span class="divider" aria-hidden="true"></span>
  <button class={["tool", { on: autoRotate }]} aria-pressed={autoRotate} onclick={() => (autoRotate = !autoRotate)} title="Spin the model slowly">
    <Rotate3d {...ICON} /><span>Auto-rotate</span>
  </button>
</div>

<style>
  .toolbar {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: stretch;
    max-width: calc(100% - 32px);
    background: var(--paper-raised);
    border: var(--rule);
    box-shadow: 4px 4px 0 var(--shadow);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 44px;
    padding: 0 14px;
    border: 0;
    background: none;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
  }
  .tool + .tool { border-left: 1px solid var(--hairline); }
  .tool:hover { background: var(--paper-sunk); }
  .tool.on { background: var(--ink); color: var(--paper); }
  .tool:focus-visible { outline-offset: -4px; }
  .divider { width: 2px; background: var(--ink); }

  @media (max-width: 900px) {
    .tool { padding: 0 12px; }
    .tool span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  }
</style>
