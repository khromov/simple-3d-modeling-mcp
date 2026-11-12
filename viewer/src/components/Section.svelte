<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** Right-aligned note next to the heading (units, counts). */
    aside?: Snippet;
    /** Take the sidebar's spare height and scroll inside. */
    grow?: boolean;
    /** Stay on the sidebar's bottom edge when the sidebar scrolls. */
    sticky?: boolean;
    children: Snippet;
  }

  let { title, aside, grow = false, sticky = false, children }: Props = $props();
</script>

<!-- Numbered like the sheets of a drawing set: 01, 02, … (a CSS counter, reset by the sidebar). -->
<section class={{ grow, sticky }}>
  <h2>
    <span class="title">{title}</span>
    {#if aside}<span class="aside">{@render aside()}</span>{/if}
  </h2>
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  section { counter-increment: section; padding: 13px 20px 15px; border-bottom: var(--rule); }
  section.grow { flex: 1 1 auto; min-height: 120px; display: flex; flex-direction: column; }
  /* The rule on top is a shadow, so it sits exactly on the previous section's rule until the sidebar scrolls. */
  section.sticky { position: sticky; bottom: 0; z-index: 1; background: var(--paper); box-shadow: 0 -2px 0 var(--ink); }
  section.grow .body { flex: 1 1 0; min-height: 0; overflow-y: auto; margin-right: -8px; padding-right: 8px; }

  h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  h2::before {
    content: counter(section, decimal-leading-zero);
    padding: 3px 5px 2px;
    background: var(--ink);
    color: var(--paper);
    font: 500 10px/1 var(--font-mono);
  }
  /* Stacked layout (App.svelte, max-width 760px): the page scrolls, so sections take their natural height. */
  @media (max-width: 760px) {
    section.sticky { position: static; box-shadow: none; }
    section.grow { min-height: 0; }
    section.grow .body { flex: none; max-height: 280px; }
  }

  .title { font-weight: 650; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
  .aside { margin-left: auto; display: flex; gap: 4px; color: var(--ink-soft); font: 500 10px var(--font-mono); text-transform: uppercase; }
</style>
