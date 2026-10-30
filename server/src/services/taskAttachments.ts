import { createWriteStream } from 'fs';
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DATA_DIR } from './dataDir.js';
import { openMedia } from './inboxService.js';
import * as syncEngine from './sync/syncEngine.js';
import * as trelloSync from './sync/trelloSync.js';
import type { Task, TaskAttachment } from '../types/index.js';

/**
 * Local copies of task attachments, so an agent can open them with its own
 * tools. The originals stay on Trello and on the inbox, so this folder is only
 * a cache: a file is dropped after a week and fetched again when asked for.
 */

const ATTACHMENT_DIR = join(DATA_DIR, 'task-attachments');
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRELLO_BYTES = 250 * 1024 * 1024;
const TRELLO_TIMEOUT_MS = 2 * 60_000;

export interface SavedAttachment {
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
}

/** Names and ids come from clients: nothing in them may shape the path. */
function safeSegment(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+|\.+$/g, '').slice(-80) || 'file';
}

async function pruneOldFiles(): Promise<void> {
  try {
    const entries = await readdir(ATTACHMENT_DIR, { recursive: true, withFileTypes: true });
    const cutoff = Date.now() - ATTACHMENT_TTL_MS;
    await Promise.all(entries.filter(e => e.isFile()).map(async entry => {
      const filePath = join(entry.parentPath, entry.name);
      try {
        if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath);
      } catch {}
    }));
  } catch {}
}

async function download(task: Task, meta: TaskAttachment, target: string): Promise<string> {
  if (meta.source === 'inbox') {
    const res = await openMedia(meta.id);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(target));
    return res.headers.get('content-type') || meta.mimeType || 'application/octet-stream';
  }

  const link = await syncEngine.resolveTrelloCard(task.projectId, task.id, task.milestoneId);
  if (!link) throw new Error('This task is not linked to a Trello card');
  const file = await trelloSync.fetchAttachmentBytes(link.config, link.cardId, meta.id, {
    maxBytes: MAX_TRELLO_BYTES,
    timeoutMs: TRELLO_TIMEOUT_MS,
  });
  // A link attachment points at some other site; Shipyard never fetches those.
  if (!file) throw new Error(`Not a file on Trello. If it is a link, open it yourself: ${meta.url}`);
  await writeFile(target, file.data);
  return file.mimeType;
}

export async function saveAttachment(task: Task, meta: TaskAttachment): Promise<SavedAttachment> {
  const path = join(
    ATTACHMENT_DIR,
    safeSegment(task.projectId),
    safeSegment(task.id),
    `${safeSegment(meta.id)}-${safeSegment(meta.name)}`,
  );
  const base = { path, name: meta.name };

  const cached = await stat(path).catch(() => null);
  if (cached) return { ...base, mimeType: meta.mimeType || 'application/octet-stream', bytes: cached.size };

  await mkdir(dirname(path), { recursive: true });
  void pruneOldFiles();

  // Written aside first: a download cut halfway must not pass for the file.
  const partial = `${path}.${randomUUID()}.part`;
  try {
    const mimeType = await download(task, meta, partial);
    await rename(partial, path);
    return { ...base, mimeType: mimeType.split(';')[0].trim().toLowerCase(), bytes: (await stat(path)).size };
  } catch (err) {
    await unlink(partial).catch(() => {});
    throw err;
  }
}
