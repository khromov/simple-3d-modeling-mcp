<script lang="ts">
  import Section from "./Section.svelte";

  let { version }: { version: number } = $props();

  /** Values match the slicers src/viewer/viewer-server.ts knows. */
  const SLICERS = [
    { value: "default", label: "System default app" },
    { value: "bambu", label: "Bambu Studio" },
    { value: "orca", label: "OrcaSlicer" },
    { value: "prusa", label: "PrusaSlicer" },
    { value: "cura", label: "UltiMaker Cura" },
    { value: "creality", label: "Creality Print" },
  ];
  const OPEN_LABEL = "Open in slicer";

  let slicer = $state("default");
  let openLabel = $state(OPEN_LABEL);
  let resetLabel: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(resetLabel));

  async function openInSlicer() {
    clearTimeout(resetLabel);
    openLabel = "Opening…";
    try {
      const res = await fetch(`/open-in-slicer/${version}?slicer=${encodeURIComponent(slicer)}`, { method: "POST" });
      openLabel = res.ok ? "✓ Opened" : "Failed — is the slicer installed?";
    } catch {
      openLabel = "Failed";
    }
    resetLabel = setTimeout(() => (openLabel = OPEN_LABEL), 3000);
  }
</script>

<Section title="Export">
  <!-- `download` makes these downloads rather than navigations; Firefox closes the page's WebSocket when a navigation starts. -->
  <a id="dl-stl" class="export" href="/model/{version}.stl" download>↓ Download STL</a>
  <a id="dl-3mf" class="export" href="/model/{version}.3mf" download>↓ Download 3MF (with colours)</a>
  <select id="slicer" bind:value={slicer} aria-label="Slicer">
    {#each SLICERS as s (s.value)}
      <option value={s.value}>{s.label}</option>
    {/each}
  </select>
  <button class="export" id="open-slicer" onclick={openInSlicer}>{openLabel}</button>
</Section>

<style>
  .export { display: block; width: 100%; padding: 8px; margin-top: 6px; background: var(--accent-bg); border: 1px solid var(--accent-border); color: var(--accent); border-radius: 6px; font-size: 12px; text-align: center; text-decoration: none; cursor: pointer; }
  .export:hover { filter: brightness(1.2); }
  select { width: 100%; margin-top: 6px; padding: 6px; background: var(--btn-bg); color: var(--text); border: 1px solid var(--btn-border); border-radius: 5px; font-size: 12px; }
</style>
