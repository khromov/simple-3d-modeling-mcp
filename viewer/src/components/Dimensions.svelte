<script lang="ts">
  import { formatMm, formatVolume } from "../lib/format.js";
  import type { ModelUpdate } from "../lib/protocol.js";
  import Section from "./Section.svelte";

  let { model }: { model: ModelUpdate | null } = $props();

  const rows = $derived.by(() => {
    if (!model) return { x: "—", y: "—", z: "—", volume: "—", triangles: "—" };
    const { size, volume, triangles } = model.stats;
    return {
      x: formatMm(size[0]),
      y: formatMm(size[1]),
      z: model.is2D ? "—" : formatMm(size[2]),
      volume: formatVolume(volume, model.is2D),
      triangles: triangles.toLocaleString(),
    };
  });
</script>

<Section title="Dimensions">
  <div class="row"><span>Width (X)</span><span class="val" id="dim-x">{rows.x}</span></div>
  <div class="row"><span>Depth (Y)</span><span class="val" id="dim-y">{rows.y}</span></div>
  <div class="row"><span>Height (Z)</span><span class="val" id="dim-z">{rows.z}</span></div>
  <div class="row"><span>Volume</span><span class="val" id="dim-v">{rows.volume}</span></div>
  <div class="row"><span>Triangles</span><span class="val" id="dim-t">{rows.triangles}</span></div>
</Section>
