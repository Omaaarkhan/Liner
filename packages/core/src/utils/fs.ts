import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MULTI_SPACE = /\s+/g;

export async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export function sanitizePathSegment(input: string, fallback = "Unknown"): string {
  const trimmed = input.trim();
  const normalized = trimmed
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(MULTI_SPACE, " ")
    .replace(/\.$/, "")
    .trim();

  return normalized.length > 0 ? normalized : fallback;
}

export function withTrackNumber(trackNumber: number | undefined, title: string): string {
  const safeTitle = sanitizePathSegment(title, "Untitled");
  if (!trackNumber || Number.isNaN(trackNumber)) {
    return safeTitle;
  }
  return `${String(trackNumber).padStart(2, "0")} - ${safeTitle}`;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function uniqueFilePath(basePath: string): Promise<string> {
  if (!(await fileExists(basePath))) {
    return basePath;
  }

  const ext = path.extname(basePath);
  const stem = basePath.slice(0, -ext.length);
  let index = 2;

  while (true) {
    const candidate = `${stem} (${index})${ext}`;
    if (!(await fileExists(candidate))) {
      return candidate;
    }
    index += 1;
  }
}
