import type { HistoryEntry, ModelUpdate, RequestModel, ServerMessage } from "./protocol.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const RETRY_MS = 2000;

/** WebSocket to the viewer server: connection status, version history and model updates. Reconnects on its own. */
export class ViewerConnection {
  status = $state<ConnectionStatus>("connecting");
  history = $state.raw<HistoryEntry[]>([]);

  readonly #onUpdate: (update: ModelUpdate) => void;
  #ws: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  /** `onUpdate` gets every model-update message: a new render, a renamed version, or a requested history entry. */
  constructor(onUpdate: (update: ModelUpdate) => void) {
    this.#onUpdate = onUpdate;
  }

  connect(): void {
    this.#closed = false;
    // The server accepts WebSockets on any path; /ws keeps them apart from Vite's own in dev.
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
    this.#ws = ws;
    ws.onopen = () => {
      this.status = "connected";
    };
    ws.onmessage = (e) => this.#receive(e.data);
    ws.onclose = () => {
      if (this.#closed || this.#ws !== ws) return;
      this.status = "disconnected";
      this.#retry = setTimeout(() => this.connect(), RETRY_MS);
    };
    ws.onerror = () => ws.close();
  }

  /** Asks the server to send a history version as a model-update. */
  requestModel(version: number): void {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    const msg: RequestModel = { type: "request-model", version };
    this.#ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#retry);
    this.#ws?.close();
    this.#ws = null;
  }

  #receive(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === "model-history") {
      this.history = msg.versions;
    } else if (msg.type === "model-update") {
      const { version, title, timestamp } = msg;
      this.history = this.history.some((h) => h.version === version)
        ? this.history.map((h) => (h.version === version ? { ...h, title } : h))
        : [...this.history, { version, title, timestamp }];
      this.#onUpdate(msg);
    }
  }
}
