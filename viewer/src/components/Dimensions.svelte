<script lang="ts">
  import { formatLength, formatVolume } from "../lib/format.js";
  import type { ModelUpdate } from "../lib/protocol.js";
  import Section from "./Section.svelte";

  let { model }: { model: ModelUpdate | null } = $props();

  // Axis colours match the axis lines drawn in the viewport.
  const axes = $derived.by(() => {
    const size = model?.stats.size;
    return [
      { axis: "x", label: "Width", value: size ? formatLength(size[0]) : "—" },
      { axis: "y", label: "Depth", value: size ? formatLength(size[1]) : "—" },
      { axis: "z", label: "Height", value: size && !model?.is2D ? formatLength(size[2]) : "—" },
    ];
  });
</script>

<Section title="Dimensions">
  {#snippet aside()}mm{/snippet}
  <dl>
    {#each axes as a (a.axis)}
      <div class="cell">
        <dt><span class={["axis", a.axis]}>{a.axis}</span>{a.label}</dt>
        <dd>{a.value}{#if a.value !== "—"}<span class="sr-only"> mm</span>{/if}</dd>
      </div>
    {/each}
    <div class="cell wide">
      <dt>Volume</dt>
      <dd>{model ? formatVolume(model.stats.volume, model.is2D) : "—"}</dd>
    </div>
    <div class="cell wide">
      <dt>Triangles</dt>
      <dd>{model ? model.stats.triangles.toLocaleString() : "—"}</dd>
    </div>
  </dl>
</Section>

<style>
  /* One ruled table: X/Y/Z on top, volume and triangle count below. */
  dl {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
    background: var(--ink);
    border: var(--rule);
  }
  .cell { grid-column: span 2; background: var(--paper-raised); padding: 7px 10px 8px; min-width: 0; }
  .cell.wide { grid-column: span 3; }
  .wide dd { font-size: 14px; }
  dt { display: flex; align-items: center; gap: 6px; min-height: 16px; color: var(--ink-soft); font-size: 11px; font-weight: 500; }
  .cell dd { margin-top: 6px; font: 500 17px/1 var(--font-mono); letter-spacing: -0.02em; overflow-wrap: anywhere; }
  .axis {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--paper);
    font: 500 10px/1 var(--font-mono);
    text-transform: uppercase;
  }
  .x { background: var(--axis-x); }
  .y { background: var(--axis-y); }
  .z { background: var(--axis-z); }
</style>
