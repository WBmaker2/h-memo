import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
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
    const result = await save({
      defaultPath: fileName,
      filters: [{ extensions: ["txt"], name: "텍스트 파일" }],
    });

    if (!result) {
      return { status: "cancelled" };
    }

    await invoke("write_text_file", { path: result, contents });
    return { status: "saved", path: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
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
