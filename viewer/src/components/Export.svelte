<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
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

  type OpenState = "idle" | "opening" | "opened" | "failed" | "unreachable";
  const OPEN_LABEL: Record<OpenState, string> = {
    idle: "Open in slicer",
    opening: "Opening…",
    opened: "Opened",
    failed: "Failed — is the slicer installed?",
    unreachable: "Failed",
  };

  let slicer = $state("default");
  let openState = $state<OpenState>("idle");
  let resetState: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(resetState));

  async function openInSlicer() {
    clearTimeout(resetState);
    openState = "opening";
    try {
      const res = await fetch(`/open-in-slicer/${version}?slicer=${encodeURIComponent(slicer)}`, { method: "POST" });
      openState = res.ok ? "opened" : "failed";
    } catch {
      openState = "unreachable";
    }
    resetState = setTimeout(() => (openState = "idle"), 3000);
  }
</script>

<Section title="Export" sticky>
  {#snippet aside()}v{version}{/snippet}
  <!-- `download` makes these downloads rather than navigations; Firefox closes the page's WebSocket when a navigation starts. -->
  <div class="downloads">
    <a class="btn file" href="/model/{version}.stl" download>
      <Download size={18} strokeWidth={2.25} />
      <span class="fmt">STL</span>
      <span class="desc">Shape only</span>
    </a>
    <a class="btn file" href="/model/{version}.3mf" download>
      <Download size={18} strokeWidth={2.25} />
      <span class="fmt">3MF</span>
      <span class="desc">With colours</span>
    </a>
  </div>

  <div class="slicer">
    <label class="select">
      <span class="sr-only">Slicer</span>
      <select bind:value={slicer}>
        {#each SLICERS as s (s.value)}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
      <ChevronDown size={18} strokeWidth={2.25} />
    </label>
    <p class="note">
      {slicer === "default" ? "Sends an STL (no colours). Pick your slicer to send a 3MF." : "Sends a 3MF with colours."}
    </p>
    <button class={["btn", "primary", "open", openState]} onclick={openInSlicer} disabled={openState === "opening"}>
      {#if openState === "opening"}
        <LoaderCircle class="spin" size={18} strokeWidth={2.25} />
      {:else if openState === "opened"}
        <Check size={18} strokeWidth={2.5} />
      {:else if openState === "idle"}
        <ExternalLink size={18} strokeWidth={2.25} />
      {:else}
        <TriangleAlert size={18} strokeWidth={2.25} />
      {/if}
      <span aria-live="polite">{OPEN_LABEL[openState]}</span>
    </button>
  </div>
</Section>

<style>
  .downloads { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .file {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    justify-content: start;
    align-items: center;
    padding: 7px 12px;
    text-align: left;
  }
  .file :global(svg) { grid-row: span 2; }
  .fmt { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; line-height: 1.1; }
  .desc { color: var(--ink-soft); font-size: 11px; font-weight: 500; line-height: 1.2; }

  .slicer { display: grid; gap: 8px; }
  .select { position: relative; display: block; }
  .note { margin-top: -3px; color: var(--ink-soft); font-size: 11px; }
  select {
    width: 100%;
    height: 40px;
    padding: 0 38px 0 12px;
    appearance: none;
    background: var(--paper-raised);
    border: var(--rule);
    border-radius: 0;
    font-weight: 500;
    cursor: pointer;
  }
  .select :global(svg) { position: absolute; right: 10px; top: 11px; pointer-events: none; }

  .open { width: 100%; min-height: 44px; font-size: 14px; letter-spacing: 0.02em; }
  .open.failed, .open.unreachable { background: var(--paper-raised); color: var(--bad); }
  .open :global(.spin) { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
