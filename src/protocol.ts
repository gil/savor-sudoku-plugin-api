// Coarse request/response over postMessage, plain structured-cloneable data
// only. No callbacks into host code, no shared memory, no streaming.
// Cancellation is worker.terminate() from the host.

export type Method = "manifest" | "generate" | "rate" | "hint";

const METHODS: readonly string[] = ["manifest", "generate", "rate", "hint"];

export interface RpcRequest {
  readonly id: number;
  readonly method: Method;
  readonly params?: unknown;
}

export type RpcResponse =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly message: string };
    };

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as { id?: unknown; method?: unknown };
  return typeof r.id === "number" && METHODS.includes(r.method as string);
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as { id?: unknown; ok?: unknown };
  return typeof r.id === "number" && typeof r.ok === "boolean";
}
