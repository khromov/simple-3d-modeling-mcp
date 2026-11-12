<script lang="ts">
  import { timeAgo } from "../lib/format.js";
  import type { HistoryEntry } from "../lib/protocol.js";
  import Section from "./Section.svelte";

  interface Props {
    entries: HistoryEntry[];
    /** Version currently shown in the viewport. */
    active: number | undefined;
    onselect: (version: number) => void;
  }

  let { entries, active, onselect }: Props = $props();

  // Refreshes the "… ago" labels; they are also recomputed whenever the list or selection changes.
  let tick = $state(0);
  $effect(() => {
    const id = setInterval(() => tick++, 20_000);
    return () => clearInterval(id);
  });

  const items = $derived.by(() => {
    void tick;
    void active;
    const now = Date.now();
    return entries
      .slice()
      .reverse()
      .map((h) => ({ ...h, ago: timeAgo(h.timestamp, now) }));
  });
</script>

<Section title="History">
  <div id="history">
    {#each items as h (h.version)}
      <button class={["history-item", { active: h.version === active }]} onclick={() => onselect(h.version)}>
        <span>v{h.version} · {h.title}</span>
        <span class="ago">{h.ago}</span>
      </button>
    {:else}
      <div class="row">No models yet</div>
    {/each}
  </div>
</Section>

<style>
  #history { max-height: 220px; overflow-y: auto; }
  .history-item {
    /* A button, laid out like the plain row it replaces. */
    width: 100%; border: 0; background: none; font: inherit; text-align: left;
    padding: 6px 8px; border-radius: 4px; margin-bottom: 3px; font-size: 11px; cursor: pointer; color: var(--muted);
    display: flex; justify-content: space-between; gap: 8px;
  }
  .history-item:hover { background: var(--btn-bg); }
  .history-item.active { background: var(--accent-bg); color: var(--accent); }
  .ago { font-size: 10px; opacity: 0.7; white-space: nowrap; }
</style>
