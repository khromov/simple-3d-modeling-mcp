<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="section">
  <h4>{title}</h4>
  {@render children()}
</div>

<style>
  .section { padding: 14px 16px; border-bottom: 1px solid var(--border); }
  h4 { color: var(--heading); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
</style>
