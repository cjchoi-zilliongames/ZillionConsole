"use client";

export function adminFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init?.signal
    ? anySignal([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, credentials: "include", signal }).finally(
    () => clearTimeout(id)
  );
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), {
      once: true,
    });
  }
  return controller.signal;
}
