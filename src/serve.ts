import { isRpcRequest, type Method, type RpcResponse } from "./protocol.js";
import type {
  EngineProvider,
  GenerateRequest,
  HintRequest,
  RateRequest,
} from "./types.js";

// The message target serve() attaches to. A DedicatedWorkerGlobalScope
// satisfies it; so does a MessagePort, which is how the round-trip tests run
// the real protocol with no worker and no mocks.
export interface ServeScope {
  postMessage(msg: unknown): void;
  addEventListener(
    type: "message",
    fn: (e: { data: unknown }) => void,
  ): void;
  start?(): void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function invoke(
  provider: EngineProvider,
  method: Method,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "manifest":
      return provider.manifest();
    case "generate":
      return await provider.generate(params as GenerateRequest);
    case "rate":
      if (!provider.rate) {
        throw new Error('this engine does not implement "rate"');
      }
      return await provider.rate(params as RateRequest);
    case "hint":
      if (!provider.hint) {
        throw new Error('this engine does not implement "hint"');
      }
      return (await provider.hint(params as HintRequest)) ?? null;
  }
}

async function respond(
  provider: EngineProvider,
  scope: ServeScope,
  data: unknown,
): Promise<void> {
  if (!isRpcRequest(data)) return;
  const { id, method, params } = data;
  let response: RpcResponse;
  try {
    response = { id, ok: true, result: await invoke(provider, method, params) };
  } catch (err) {
    response = { id, ok: false, error: { message: messageOf(err) } };
  }
  scope.postMessage(response);
}

/**
 * Runs inside the plugin's worker. Installs the message handler, decodes each
 * request, dispatches to the provider method it names, and posts the response
 * back with the matching id. Plugin authors write no postMessage plumbing.
 */
export function serve(provider: EngineProvider, scope?: ServeScope): void {
  const target = scope ?? (self as unknown as ServeScope);
  target.addEventListener("message", (e) => {
    void respond(provider, target, e.data);
  });
  target.start?.();
}
