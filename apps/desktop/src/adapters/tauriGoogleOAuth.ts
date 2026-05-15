import { invoke } from "@tauri-apps/api/core";
import type { GoogleOAuthTokens } from "@h-memo/memo-sync";

export function startGoogleDesktopOAuth(clientId: string): Promise<GoogleOAuthTokens> {
  return invoke<GoogleOAuthTokens>("start_google_desktop_oauth", { clientId });
}
