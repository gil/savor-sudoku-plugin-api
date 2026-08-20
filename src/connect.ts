import { isRpcResponse, type Method, type RpcRequest } from "./protocol.js";
import type {
  EngineManifest,
  GenerateRequest,
  GenerateResult,
  HintRequest,
  HintResult,
  RateRequest,
  RateResult,
} from "./types.js";

// The transport seam. Defaults to spawning a module Worker from the URL; tests
// pass a MessageChannel-backed transport with the real provider on the far
// port, which exercises the protocol, the host, and the providers together
// with zero mocking.
export interface Transport {
  postMessage(msg: unknown): void;
  addEventListener(
    type: "message" | "error",
    fn: (e: unknown) => void,
  ): void;
  terminate(): void;
}

export interface EngineClient {
  readonly manifest: EngineManifest;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  rate(req: RateRequest): Promise<RateResult>;
  hint(req: HintRequest): Promise<HintResult | null>;
  terminate(): void;
}

export interface ConnectOptions {
  timeoutMs?: number;
  transport?: (url: string) => Transport;
}

// Generous on purpose: the built-in generator's bands 8-9 take tens of seconds.
// The "Creating Puzzle" busy dialog already covers the wait.
export const DEFAULT_TIMEOUT_MS = 120_000;
// SE's dynamic forcing chains are genuinely slow, which is why rate gets a
// larger budget than hint. A hint is interactive; nobody waits a minute for it.
export const RATE_TIMEOUT_MS = 60_000;
export const HINT_TIMEOUT_MS = 20_000;

const METHOD_TIMEOUT_MS: Readonly<Record<Method, number>> = {
  manifest: DEFAULT_TIMEOUT_MS,
  generate: DEFAULT_TIMEOUT_MS,
  rate: RATE_TIMEOUT_MS,
  hint: HINT_TIMEOUT_MS,
};

function workerTransport(url: string): Transport {
  const worker = new Worker(url, { type: "module" });
  return {
    postMessage: (msg) => worker.postMessage(msg),
    addEventListener: (type, fn) =>
      worker.addEventListener(type, fn as EventListener),
    terminate: () => worker.terminate(),
  };
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

class Connection {
  private nextId = 1;
  private dead = false;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly transport: Transport,
    // Set only when the caller overrides every method's budget at once; the
    // EngineHost test seam does exactly that.
    private readonly override: number | undefined,
  ) {
    transport.addEventListener("message", (e) => this.onMessage(e));
    // A worker `error` is fatal immediately. A `messageerror` produces no
    // response at all, so the per-call timeout catches it — same outcome,
    // which is why the Transport surface stays at two event types.
    transport.addEventListener("error", () =>
      this.failAll("engine worker error"),
    );
  }

  private timeoutFor(method: Method): number {
    return this.override ?? METHOD_TIMEOUT_MS[method];
  }

  call(method: Method, params?: unknown): Promise<unknown> {
    if (this.dead) {
      return Promise.reject(new Error("engine terminated"));
    }
    const id = this.nextId++;
    const timeoutMs = this.timeoutFor(method);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll(`engine call "${method}" timed out after ${timeoutMs}ms`);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const request: RpcRequest = { id, method, params };
      this.transport.postMessage(request);
    });
  }

  terminate(): void {
    this.failAll("engine terminated");
  }

  private onMessage(e: unknown): void {
    const data = (e as { data?: unknown }).data;
    if (!isRpcResponse(data)) return;
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error.message || "engine error"));
  }

  // Every failure mode is fatal to the connection: the host terminates the
  // worker and rejects everything in flight. A fresh connect() is the retry.
  private failAll(message: string): void {
    if (this.dead) return;
    this.dead = true;
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.transport.terminate();
  }
}

/**
 * Runs in the app's main thread. Spawns the worker, performs the `manifest`
 * handshake, and returns a typed client that tracks pending requests by id,
 * enforces a per-call timeout, and terminates on expiry.
 *
 * The returned manifest is NOT validated here — validation is the host's job,
 * because the host is what knows the registry entry it was supposed to match.
 */
export async function connect(
  url: string,
  opts: ConnectOptions = {},
): Promise<EngineClient> {
  const make = opts.transport ?? workerTransport;
  const conn = new Connection(make(url), opts.timeoutMs);
  try {
    const manifest = (await conn.call("manifest")) as EngineManifest;
    return {
      manifest,
      generate: (req) => conn.call("generate", req) as Promise<GenerateResult>,
      rate: (req) => conn.call("rate", req) as Promise<RateResult>,
      hint: (req) => conn.call("hint", req) as Promise<HintResult | null>,
      terminate: () => conn.terminate(),
    };
  } catch (err) {
    conn.terminate();
    throw err;
  }
}
