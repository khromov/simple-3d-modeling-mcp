<script lang="ts">
  import { highlightLines } from "../lib/highlight.js";

  /** Read-only, highlighted OpenSCAD with line numbers. */
  let { code, large = false }: { code: string; large?: boolean } = $props();

  const lines = $derived(highlightLines(code));
</script>

<!-- Tokens are text, never HTML. Line numbers are a CSS counter, so selecting the code doesn't copy them. -->
<pre class={{ large, wide: lines.length >= 1000 }}><code
  >{#each lines as line, i (i)}<span class="line"
      >{#each line as token, j (j)}<span class={`tok-${token.type}`}>{token.text}</span>{/each}</span
    >{/each}</code
></pre>

<style>
  pre {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    padding: 8px 0;
    counter-reset: line;
    font: 400 11.5px/1.6 var(--font-mono);
    tab-size: 4;
  }
  .large { padding: 20px 0; font-size: 14px; }
  code { display: block; width: max-content; min-width: 100%; font: inherit; }
  .line { display: block; min-height: 1.6em; padding-right: 16px; counter-increment: line; }
  .line::before {
    content: counter(line);
    display: inline-block;
    width: 3ch;
    margin: 0 12px 0 10px;
    text-align: right;
    color: var(--ink-faint);
    user-select: none;
  }
  .large .line::before { margin: 0 20px 0 24px; }
  .wide .line::before { width: 4ch; }

  .tok-comment { color: var(--code-comment); font-style: italic; }
  .tok-string, .tok-path { color: var(--code-string); }
  .tok-number { color: var(--code-number); }
  .tok-keyword { color: var(--code-keyword); font-weight: 500; }
  .tok-builtin { color: var(--code-builtin); }
  .tok-special { color: var(--code-special); }
  .tok-definition { color: var(--ink); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
  .tok-operator { color: var(--ink-soft); }
  .tok-text { color: var(--ink); }
</style>
