<script lang="ts">
  import Section from "./Section.svelte";

  let { dark = $bindable(), color = $bindable() }: { dark: boolean; color: string } = $props();
</script>

<Section title="Appearance">
  <div class="row">
    <span>Theme</span>
    <button class="btn toggle" id="theme" onclick={() => (dark = !dark)}>{dark ? "Light" : "Dark"}</button>
  </div>
  <div class="row">
    <span>Model colour</span>
    <input type="color" id="color" bind:value={color} title="Used for parts without color()" aria-label="Model colour" />
  </div>
</Section>

<style>
  .toggle { padding: 3px 10px; }
  input { width: 28px; height: 22px; border: 1px solid var(--btn-border); border-radius: 4px; background: none; cursor: pointer; padding: 0; }
</style>
