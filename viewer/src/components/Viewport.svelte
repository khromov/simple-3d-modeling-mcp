<script lang="ts">
  import type { ViewerMesh } from "../lib/mesh.js";
  import { ViewerScene } from "../lib/scene.js";
  import Controls from "./Controls.svelte";
  import Logo from "./Logo.svelte";

  interface Props {
    /** The model to show; null until the first one arrives. */
    mesh: ViewerMesh | null;
    dark: boolean;
    modelColor: string;
  }

  let { mesh, dark, modelColor }: Props = $props();

  let edges = $state(true);
  let wireframe = $state(false);
  let autoRotate = $state(false);
  let grid = $state(true);

  const scene = new ViewerScene({ onAutoRotateStop: () => (autoRotate = false) });
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

<div class="viewport" {@attach (container) => scene.mount(container)}>
  <!-- Registration marks in the corners, as on a drawing sheet. -->
  <span class="mark tl" aria-hidden="true"></span>
  <span class="mark tr" aria-hidden="true"></span>
  <span class="mark bl" aria-hidden="true"></span>
  <span class="mark br" aria-hidden="true"></span>

  <!-- Top-right annotations, like the legend of a drawing: which arrow is which axis, and how to move. -->
  <div class="legend">
    {#if mesh && grid}
      <ul class="axes" aria-label="Axis colours">
        {#each ["x", "y", "z"] as axis (axis)}
          <li class={axis}>
            <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
              <rect y="3.5" width="16" height="3" fill="currentColor" />
              <polygon points="15,0 24,5 15,10" fill="currentColor" />
            </svg>
            {axis.toUpperCase()}
          </li>
        {/each}
      </ul>
    {/if}
    <ul class="hint">
      <li><kbd>Drag</kbd> rotate</li>
      <li><kbd>Scroll</kbd> zoom</li>
      <li><kbd>Right-drag</kbd> pan</li>
    </ul>
  </div>

  {#if mesh}
    <Controls bind:edges bind:wireframe bind:autoRotate bind:grid onreset={() => scene.resetView()} />
  {:else}
    <div class="empty">
      <Logo size={72} />
      <p class="title">Waiting for a model</p>
      <p>Render something from your AI assistant and it appears here.</p>
    </div>
  {/if}
</div>

<style>
  .viewport {
    flex: 1;
    position: relative;
    min-width: 0;
    /* The canvas is transparent: this is the paper the model is drawn on. */
    background: radial-gradient(ellipse at 50% 45%, transparent 45%, var(--vignette)), var(--paper);
  }

  .mark { position: absolute; width: 18px; height: 18px; pointer-events: none; border: 0 solid var(--ink); }
  .tl { top: 12px; left: 12px; border-width: 2px 0 0 2px; }
  .tr { top: 12px; right: 12px; border-width: 2px 2px 0 0; }
  .bl { bottom: 12px; left: 12px; border-width: 0 0 2px 2px; }
  .br { bottom: 12px; right: 12px; border-width: 0 2px 2px 0; }

  .legend {
    position: absolute;
    top: 22px;
    right: 40px;
    left: 40px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    pointer-events: none;
  }
  .hint {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px 14px;
    list-style: none;
    color: var(--ink-soft);
    font-size: 12px;
  }
  kbd {
    margin-right: 3px;
    padding: 1px 5px;
    border: 1.5px solid var(--ink-faint);
    border-bottom-width: 3px;
    font: 500 10px var(--font-mono);
    text-transform: uppercase;
    color: var(--ink);
  }

  .axes { display: flex; gap: 14px; list-style: none; font: 500 11px var(--font-mono); }
  .axes li { display: flex; align-items: center; gap: 5px; }
  .x svg { color: var(--axis-x); }
  .y svg { color: var(--axis-y); }
  .z svg { color: var(--axis-z); }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    color: var(--ink-soft);
  }
  .empty .title { margin-top: 18px; color: var(--ink); font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }

  @media (max-width: 900px) {
    .hint { display: none; }
  }
</style>
