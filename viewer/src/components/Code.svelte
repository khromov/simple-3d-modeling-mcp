<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import FileCode from "@lucide/svelte/icons/file-code";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import X from "@lucide/svelte/icons/x";
  import type { ModelSource } from "../lib/protocol.js";
  import CodeView from "./CodeView.svelte";
  import Section from "./Section.svelte";

  interface Props {
    /** Version in the viewport; its source is fetched from the server. */
    version: number | undefined;
    title: string | undefined;
  }

  let { version, title }: Props = $props();

  let source = $state.raw<ModelSource | null>(null);
  let loaded = $state(false);
  // Keeps showing the previous code until the new version's arrives; a stale response is dropped.
  $effect(() => {
    const v = version;
    if (v === undefined) {
      source = null;
      loaded = false;
      return;
    }
    let current = true;
    fetch(`/source/${v}`)
      .then((res) => (res.ok ? (res.json() as Promise<ModelSource>) : null))
      .catch(() => null)
      .then((s) => {
        if (!current) return;
        source = s;
        loaded = true;
      });
    return () => {
      current = false;
    };
  });


  let copied = $state(false);
  let copyReset: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(copyReset));
  async function copy() {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.code);
      copied = true;
      clearTimeout(copyReset);
      copyReset = setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard unavailable; the code can still be selected by hand.
    }
  }

  let dialog: HTMLDialogElement | undefined = $state();
</script>

{#snippet params(list: string[])}
  <p class="params"><span>Overrides</span>{#each list as p (p)}<span class="tag">-D {p}</span>{/each}</p>
{/snippet}

<Section title="Code" grow>
  {#snippet aside()}
    {#if source}
      <button class="icon" onclick={copy} aria-label="Copy code" title="Copy code">
        {#if copied}<Check size={15} strokeWidth={2.5} />{:else}<Copy size={15} strokeWidth={2.25} />{/if}
      </button>
      <button class="icon" onclick={() => dialog?.showModal()} aria-label="Show code full screen" title="Full screen">
        <Maximize2 size={15} strokeWidth={2.25} />
      </button>
    {/if}
  {/snippet}
  {#if source}
    <div class="editor">
      {#if source.params}{@render params(source.params)}{/if}
      <CodeView code={source.code} />
    </div>
  {:else}
    <p class="none">{version === undefined ? "No model yet" : loaded ? "No source for this version" : ""}</p>
  {/if}
</Section>

<!-- Full screen: a modal <dialog>, so Escape closes it and focus stays inside. Read-only, like the panel. -->
<dialog bind:this={dialog} class="sheet" aria-label="Code">
  {#if source}
    <header>
      {#if source.file}<span class="file"><FileCode size={16} strokeWidth={2.25} />{source.file}</span>{/if}
      <span class="title">{title}{#if version !== undefined}<span class="tag">v{version}</span>{/if}</span>
      <button class="btn" onclick={copy}>
        {#if copied}<Check size={16} strokeWidth={2.5} />Copied{:else}<Copy size={16} strokeWidth={2.25} />Copy{/if}
      </button>
      <button class="btn close" onclick={() => dialog?.close()} aria-label="Close full screen" title="Close (Esc)">
        <X size={18} strokeWidth={2.5} />
      </button>
    </header>
    {#if source.params}{@render params(source.params)}{/if}
    <CodeView code={source.code} large />
  {/if}
</dialog>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--paper-raised);
    border: var(--rule);
  }
  /* Copy and full screen, in the section heading. */
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin: -4px 0;
    border: 0;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .icon:hover { background: var(--paper-sunk); }

  .params {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--hairline);
    color: var(--ink-soft);
    font-size: 11px;
  }
  .params .tag { text-transform: none; color: var(--ink); }

  .none { color: var(--ink-faint); }

  dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--paper);
    color: var(--ink);
  }
  dialog[open] { display: flex; flex-direction: column; }
  dialog::backdrop { background: transparent; }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 60px;
    padding: 0 16px 0 24px;
    border-bottom: var(--rule);
  }
  .file { display: flex; align-items: center; gap: 6px; flex: none; color: var(--ink-soft); font: 500 13px var(--font-mono); }
  .title { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; font-weight: 650; font-size: 17px; }
  .close { width: 40px; padding: 0; }
  dialog .params { padding: 10px 24px; font-size: 12px; }

  /* Stacked layout (App.svelte): the panel has no height to fill, so give the code one. */
  @media (max-width: 760px) {
    .editor { height: 260px; }
  }
</style>
