<script lang="ts">
  /** Bauhaus mark: circle, square, triangle and a quarter disc on a 2×2 grid. Decorative. */
  let { size = 24 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
  <circle class="red" cx="8" cy="8" r="7" />
  <rect class="blue" x="17" y="1" width="14" height="14" />
  <polygon class="yellow" points="8,17 15,31 1,31" />
  <path class="ink" d="M17 31V17A14 14 0 0 1 31 31Z" />
</svg>

<style>
  svg { display: block; flex: none; }
  .red { fill: var(--bauhaus-red); }
  .blue { fill: var(--bauhaus-blue); }
  .yellow { fill: var(--bauhaus-yellow); }
  .ink { fill: var(--ink); }
</style>
