import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker, resolveServiceWorkerUrl, SERVICE_WORKER_PATH } from "./serviceWorker";

describe("registerServiceWorker", () => {
  it("resolves service worker path with vite base path", () => {
    const scriptUrl = resolveServiceWorkerUrl("/app/", "https://example.com/app/index.html");
    expect(scriptUrl).toBe("https://example.com/app/sw.js");
  });

  it("falls back to root path when base is empty", () => {
    const scriptUrl = resolveServiceWorkerUrl("", "https://example.com/app/");
    expect(scriptUrl).toBe("https://example.com/sw.js");
  });

  it("returns unsupported when service worker API is missing", async () => {
    const original = (globalThis as { navigator?: Navigator }).navigator;

    const fallbackNavigator = Object.create(original ?? {});
    Object.defineProperty(fallbackNavigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: fallbackNavigator,
    });

    const result = await registerServiceWorker(SERVICE_WORKER_PATH);
    expect(result.status).toBe("unsupported");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  });

  it("returns registered when registration succeeds", async () => {
    const registration = { scope: "/" } as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: { register },
      },
    });

    const result = await registerServiceWorker(new URL("sw.js", "https://example.com/app/").href);
    expect(result.status).toBe("registered");
    if (result.status === "registered") {
      expect(result.registration).toBe(registration);
    }
    expect(register).toHaveBeenCalledWith(new URL("sw.js", "https://example.com/app/").href);
  });

  it("returns failed when registration throws", async () => {
    const register = vi.fn().mockRejectedValue(new Error("register failed"));

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: { register },
      },
    });

    const result = await registerServiceWorker(new URL("sw.js", "https://example.com/app/").href);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect((result.error as Error).message).toBe("register failed");
    }
  });
});
