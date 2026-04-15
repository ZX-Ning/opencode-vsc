/*
 * Maintains the long-lived global OpenCode event stream and reconnect behavior.
 */
import { EventEmitter } from "events";
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client";
import { Client } from "./client";
import { ProcessManager } from "./process-manager";

export class EventStream extends EventEmitter {
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly proc: ProcessManager,
    private readonly client: Client,
  ) {
    super();
    this.proc.on("statusChange", (status) => {
      this.proc.log(`EventStream observed process status=${status}`);
      if (status === "running") {
        void this.connect();
        return;
      }
      this.disconnect();
    });
  }

  /** Opens the global event stream once the managed server is ready. */
  private async connect() {
    if (this.abort) return;

    this.abort = new AbortController();
    this.proc.log("EventStream connect start");
    try {
      const sdk = this.client.raw;
      if (!sdk) {
        this.proc.log("EventStream connect skipped: SDK unavailable");
        return;
      }
      const result = await sdk.global.event({
        signal: this.abort.signal,
      });
      this.proc.log("EventStream connected");

      for await (const event of result.stream) {
        this.proc.log(`EventStream event ${event.payload.type}`);
        this.emit("event", event);
      }
      this.proc.log("EventStream completed");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      this.proc.log(`EventStream error: ${err instanceof Error ? err.message : String(err)}`);
      this.emit("error", err);
      this.scheduleReconnect();
    } finally {
      this.abort = undefined;
    }
  }

  /** Retries the stream after transient failures without hammering the server. */
  private scheduleReconnect() {
    if (this.timer) return;
    this.proc.log("EventStream scheduling reconnect");
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.proc.status === "running") {
        void this.connect();
      }
    }, 1000);
  }

  /** Cancels any active stream work when the managed server stops or the extension disposes. */
  private disconnect() {
    this.proc.log("EventStream disconnect");
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.abort) {
      this.abort.abort();
      this.abort = undefined;
    }
  }
}
