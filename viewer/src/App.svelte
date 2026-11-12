<script lang="ts">
  import Appearance from "./components/Appearance.svelte";
  import Dimensions from "./components/Dimensions.svelte";
  import Export from "./components/Export.svelte";
  import History from "./components/History.svelte";
  import Section from "./components/Section.svelte";
  import TopBar from "./components/TopBar.svelte";
  import Viewport from "./components/Viewport.svelte";
  import { ViewerConnection } from "./lib/connection.svelte.js";
  import { modelTitle } from "./lib/format.js";
  import { decodeViewerMesh, type ViewerMesh } from "./lib/mesh.js";
  import type { ModelUpdate } from "./lib/protocol.js";

  const THEME_KEY = "viewer-theme";
  const PAGE_TITLE = document.title;

  /** The theme picked with the toggle, else the OS preference. */
  function initialDark(): boolean {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) return saved === "dark";
    } catch {
      // Storage can be unavailable; fall back to the OS preference.
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  let model = $state.raw<{ info: ModelUpdate; mesh: ViewerMesh } | null>(null);
  let dark = $state(initialDark());
  let modelColor = $state("#ff8c00");

  function toggleTheme() {
    dark = !dark;
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // Not remembered, but the toggle still works.
    }
  }

  // Only the most recent update is shown, even if an older mesh download finishes later.
  let latestUpdate = 0;
  async function showUpdate(info: ModelUpdate) {
    const request = ++latestUpdate;
    try {
      const res = await fetch(`/mesh/${info.version}`);
      if (!res.ok) return;
      const mesh = decodeViewerMesh(await res.arrayBuffer());
      if (request === latestUpdate) model = { info, mesh };
    } catch (err) {
      console.error(`Could not load model v${info.version}`, err);
    }
  }

  const connection = new ViewerConnection(showUpdate);
  $effect(() => {
    connection.connect();
    return () => connection.close();
  });

  $effect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  });
  $effect(() => {
    document.title = model ? `${modelTitle(model.info)} — ${PAGE_TITLE}` : PAGE_TITLE;
  });
</script>

<div class="app">
  <TopBar status={connection.status} {dark} ontoggletheme={toggleTheme} />

  <main>
    <Viewport mesh={model?.mesh ?? null} {dark} {modelColor} />

    <aside class="sidebar">
      <Section title="Model">
        {#snippet aside()}
          {#if model}
            <span class="tag">v{model.info.version}</span>
            <span class="tag">{model.info.is2D ? "2D" : "3D"}</span>
          {/if}
        {/snippet}
        {#if model}
          <p class="title">{model.info.title}</p>
          {#if model.info.is2D}<p class="meta">Flat shape, shown 1 mm thick</p>{/if}
        {:else}
          <p class="title none">No model yet</p>
        {/if}
      </Section>
      <Dimensions model={model?.info ?? null} />
      <History entries={connection.history} active={model?.info.version} onselect={(version) => connection.requestModel(version)} />
      <Appearance bind:color={modelColor} />
      {#if model}
        <Export version={model.info.version} />
      {/if}
    </aside>
  </main>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100%; }
  main { flex: 1; display: flex; min-height: 0; }

  .sidebar {
    counter-reset: section;
    width: 336px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: var(--rule);
    overflow-y: auto;
  }
  /* The last section sits on the bottom edge: no rule needed under it. */
  .sidebar > :global(:last-child) { border-bottom: 0; }

  .title { font-size: 22px; font-weight: 650; line-height: 1.15; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .title.none { color: var(--ink-faint); }
  .meta { margin-top: 4px; color: var(--ink-soft); font-size: 12px; }

  /* Narrow windows: the viewport on top, the sidebar below it, and the page scrolls. */
  @media (max-width: 760px) {
    :global(body) { overflow: auto; }
    .app { height: auto; }
    main { flex-direction: column; }
    main > :global(.viewport) { flex: none; height: 62vh; }
    .sidebar { width: auto; border-left: 0; border-top: var(--rule); overflow: visible; }
  }
</style>
