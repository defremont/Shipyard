import { writeFile, rename } from 'fs/promises';

/**
 * Write JSON so a reader never sees half a file.
 *
 * Writing straight over the target truncates it first: if the process dies in
 * that window — app closed mid-save, machine asleep — what stays on disk is a
 * cut-off file, and the next read fails to parse it. Writing to a sibling and
 * renaming makes the swap atomic, so a reader gets either the old content or
 * the new one. The bigger the file, the wider the window: one 1.3 MB tasks file
 * here produced 855 corruption snapshots on its own.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, path);
}
