export const SERVICE_WORKER_PATH = "sw.js";

export function resolveServiceWorkerUrl(
  baseUrl = "/",
  locationHref = typeof location === "undefined" ? "http://localhost/" : location.href
): string {
  const normalizedBaseUrl = baseUrl || "/";
  return new URL(SERVICE_WORKER_PATH, new URL(normalizedBaseUrl, locationHref)).href;
}

export type ServiceWorkerRegistrationResult =
  | {
      status: "unsupported";
    }
  | {
      status: "registered";
      registration: ServiceWorkerRegistration;
    }
  | {
      status: "failed";
      error: unknown;
    };

export async function registerServiceWorker(
  scriptPath = resolveServiceWorkerUrl()
): Promise<ServiceWorkerRegistrationResult> {
  const serviceWorkerApi = navigator.serviceWorker;
  if (
    !("serviceWorker" in navigator) ||
    typeof serviceWorkerApi !== "object" ||
    serviceWorkerApi === null ||
    typeof serviceWorkerApi.register !== "function"
  ) {
    return { status: "unsupported" };
  }

  try {
    const registration = await serviceWorkerApi.register(scriptPath);
    return { status: "registered", registration };
  } catch (error) {
    return { status: "failed", error };
  }
}
