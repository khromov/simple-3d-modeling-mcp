<script lang="ts">
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import type { ConnectionStatus } from "../lib/connection.svelte.js";
  import Logo from "./Logo.svelte";

  interface Props {
    status: ConnectionStatus;
    dark: boolean;
    ontoggletheme: () => void;
  }

  let { status, dark, ontoggletheme }: Props = $props();

  const STATUS_TEXT: Record<ConnectionStatus, string> = {
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected — retrying",
  };

  const themeLabel = $derived(dark ? "Switch to light theme" : "Switch to dark theme");
</script>

<header>
  <div class="brand">
    <Logo size={26} />
    <span class="name">Sketchpad 3D</span>
  </div>

  <div class="actions">
    <div class={["status", status]} role="status">
      <span class="dot" aria-hidden="true"></span>
      {STATUS_TEXT[status]}
    </div>
    <button class="btn theme" onclick={ontoggletheme} aria-label={themeLabel} title={themeLabel}>
      {#if dark}<Sun size={18} strokeWidth={2.25} />{:else}<Moon size={18} strokeWidth={2.25} />{/if}
    </button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 60px;
    padding: 0 16px 0 18px;
    border-bottom: var(--rule);
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .name { font-weight: 650; font-size: 17px; letter-spacing: -0.01em; white-space: nowrap; }

  .actions { display: flex; align-items: center; gap: 14px; }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--ok); background: var(--ok); }
  .connecting .dot { border-color: var(--ink-faint); background: transparent; animation: pulse 1s ease-in-out infinite alternate; }
  .disconnected { color: var(--bad); }
  .disconnected .dot { border-color: var(--bad); background: transparent; }
  @keyframes pulse { to { opacity: 0.25; } }

  .theme { width: 40px; padding: 0; }

  @media (max-width: 560px) {
    .status { font-size: 0; gap: 0; } /* keep the dot, drop the words; screen readers still get them */
  }
</style>
