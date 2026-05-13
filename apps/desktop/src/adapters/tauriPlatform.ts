import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export async function exportTextFile(
  fileName: string,
  contents: string
): Promise<string> {
  const result = await save({
    defaultPath: fileName,
    filters: [{ extensions: ["txt"], name: "텍스트 파일" }],
  });

  if (!result) {
    return "취소됨";
  }

  await writeTextFile(result, contents);
  return result;
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
