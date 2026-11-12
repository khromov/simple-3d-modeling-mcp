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

<Section title="History" grow>
  {#snippet aside()}{entries.length} {entries.length === 1 ? "version" : "versions"}{/snippet}
  {#if items.length}
    <!-- Newest first, on a timeline: the filled node is the version in the viewport. -->
    <ol>
      {#each items as h, i (h.version)}
        <li>
          <button
            class={["entry", { active: h.version === active }]}
            aria-current={h.version === active ? "true" : undefined}
            onclick={() => onselect(h.version)}
          >
            <span class="node" aria-hidden="true"></span>
            <span class="ver">v{h.version}</span>
            <span class="name">{h.title}</span>
            {#if i === 0}<span class="tag latest">Latest</span>{/if}
            <span class="ago">{h.ago}</span>
          </button>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="none">No models yet</p>
  {/if}
</Section>

<style>
  ol { list-style: none; position: relative; }
  /* The timeline's spine, through the centre of every node (8px row padding + half the 16px column). */
  ol::before { content: ""; position: absolute; left: 15px; top: 14px; bottom: 14px; width: 2px; background: var(--ink); }

  .entry {
    position: relative;
    display: grid;
    grid-template-columns: 16px auto 1fr auto auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px 6px 8px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .entry:hover .name { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1.5px; }
  .node { justify-self: center; width: 12px; height: 12px; border: 2px solid var(--ink); background: var(--paper); }
  .ver { font: 500 11px var(--font-mono); color: var(--ink-soft); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .ago { font: 500 10px var(--font-mono); color: var(--ink-faint); white-space: nowrap; }
  .latest { color: var(--ink-soft); font-size: 9px; }

  /* The version in the viewport: inverted, like a toolbar toggle that is on. */
  .active { background: var(--ink); color: var(--paper); }
  .active .node { width: 14px; height: 14px; border-color: var(--paper); background: var(--bauhaus-red); }
  .active .name { font-weight: 650; }
  .active .ver, .active .ago, .active .latest { color: var(--paper); }
  .active .ago { opacity: 0.75; }

  .none { color: var(--ink-faint); }
</style>
