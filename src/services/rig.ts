/**
 * Health checks for the local laya browser rig (browser-rig/): headless Chrome on the CDP
 * port, the laya decision server, and the spec server. `rig check` in the CLI reports these.
 */

export interface RigServiceCheck {
  service: "chrome-cdp" | "decision" | "spec";
  url: string;
  ok: boolean;
  detail: string;
}

export interface RigEndpoints {
  cdp: string;
  decision: string;
  spec: string;
}

export const DEFAULT_RIG_ENDPOINTS: RigEndpoints = {
  cdp: "http://127.0.0.1:9222",
  decision: "http://127.0.0.1:8791",
  spec: "http://127.0.0.1:30000",
};

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

async function probe(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { ok: res.ok, detail: `HTTP ${res.status} ${body.slice(0, 80)}` };
  } catch (err) {
    return { ok: false, detail: `unreachable: ${(err as Error).message}` };
  }
}

export async function checkRigServices(
  fetchImpl: FetchLike,
  endpoints: RigEndpoints = DEFAULT_RIG_ENDPOINTS,
  timeoutMs = 1500,
): Promise<RigServiceCheck[]> {
  const [cdp, decision, spec] = await Promise.all([
    probe(fetchImpl, `${endpoints.cdp}/json/version`, timeoutMs),
    probe(fetchImpl, `${endpoints.decision}/`, timeoutMs),
    probe(fetchImpl, `${endpoints.spec}/spec`, timeoutMs),
  ]);
  return [
    { service: "chrome-cdp", url: `${endpoints.cdp}/json/version`, ok: cdp.ok, detail: cdp.detail },
    { service: "decision", url: `${endpoints.decision}/`, ok: decision.ok, detail: decision.detail },
    { service: "spec", url: `${endpoints.spec}/spec`, ok: spec.ok, detail: spec.detail },
  ];
}
