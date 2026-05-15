import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";

export type ExportTextFileResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export async function exportTextFile(
  fileName: string,
  contents: string
): Promise<ExportTextFileResult> {
  try {
    const savedPath = await invoke<string | null>("export_text_file", {
      fileName,
      contents,
    });

    if (savedPath == null) {
      return { status: "cancelled" };
    }

    return { status: "saved", path: savedPath };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return { status: "failed", message };
  }
}

export async function exportJsonFile(
  fileName: string,
  contents: string
): Promise<ExportTextFileResult> {
  try {
    const savedPath = await invoke<string | null>("export_json_file", {
      fileName,
      contents,
    });

    if (savedPath == null) {
      return { status: "cancelled" };
    }

    return { status: "saved", path: savedPath };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return { status: "failed", message };
  }
}

export type ImportJsonFileResult =
  | { status: "loaded"; contents: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export async function importJsonFile(): Promise<ImportJsonFileResult> {
  try {
    const contents = await invoke<string | null>("import_json_file");

    if (contents == null) {
      return { status: "cancelled" };
    }

    return { status: "loaded", contents };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return { status: "failed", message };
  }
}

export async function getStartupEnabled(): Promise<boolean> {
  return isEnabled();
}

export async function setStartupEnabled(enabled: boolean): Promise<boolean> {
  if (enabled) {
    await enable();
  } else {
    await disable();
  }

  return isEnabled();
}
