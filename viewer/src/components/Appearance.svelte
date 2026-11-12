<script lang="ts">
  import Pipette from "@lucide/svelte/icons/pipette";
  import Section from "./Section.svelte";

  let { color = $bindable() }: { color: string } = $props();

  const PRESETS = [
    { hex: "#ff8c00", name: "Orange" },
    { hex: "#d63c26", name: "Red" },
    { hex: "#f2b330", name: "Yellow" },
    { hex: "#2f67c7", name: "Blue" },
    { hex: "#7a7a7a", name: "Grey" },
    { hex: "#f4f4f2", name: "White" },
  ];

  const isCustom = $derived(!PRESETS.some((p) => p.hex === color.toLowerCase()));
</script>

<Section title="Model colour">
  {#snippet aside()}{color}{/snippet}
  <div class="swatches" role="radiogroup" aria-label="Model colour">
    {#each PRESETS as p (p.hex)}
      <button
        class="swatch"
        role="radio"
        aria-checked={color.toLowerCase() === p.hex}
        aria-label={p.name}
        title={p.name}
        onclick={() => (color = p.hex)}
      >
        <!-- An SVG fill rather than a style attribute: the page's CSP forbids inline styles. -->
        <svg viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill={p.hex} /></svg>
      </button>
    {/each}
    <label class={["swatch", "custom", { selected: isCustom }]} title="Pick any colour">
      <input type="color" bind:value={color} aria-label="Custom model colour" />
      <Pipette size={15} strokeWidth={2.25} />
    </label>
  </div>
  <p class="help">Used for parts without <code>color()</code>.</p>
</Section>

<style>
  .swatches { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; max-width: 320px; }
  .swatch {
    position: relative;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    padding: 0;
    border: var(--rule);
    background: var(--paper-raised);
    cursor: pointer;
  }
  .swatch svg { width: 100%; height: 100%; display: block; }
  .swatch:hover { transform: translate(-1px, -1px); box-shadow: 2px 2px 0 var(--shadow); }
  .swatch[aria-checked="true"], .swatch.selected { box-shadow: var(--lift) var(--lift) 0 var(--shadow); transform: translate(-1px, -1px); outline: 2px solid var(--ink); outline-offset: 2px; }
  .custom { background: conic-gradient(var(--bauhaus-red), var(--bauhaus-yellow), var(--bauhaus-blue), var(--bauhaus-red)); color: #161616; }
  .custom :global(svg) { width: 15px; height: 15px; padding: 2px; box-sizing: content-box; background: #ffffffd0; }
  .custom:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; }

  .help { margin-top: 8px; color: var(--ink-soft); font-size: 12px; }
  code { font: 500 11px var(--font-mono); }
</style>
