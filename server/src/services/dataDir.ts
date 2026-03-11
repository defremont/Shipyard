import { resolve } from 'path';

/**
 * Centralized data directory resolution.
 * In Electron, DEVDASH_DATA_DIR is set to app.getPath('userData')/data.
 * In dev mode, it falls back to {projectRoot}/data.
 */
export const DATA_DIR = process.env.DEVDASH_DATA_DIR
  ? resolve(process.env.DEVDASH_DATA_DIR)
  : resolve(import.meta.dirname, '../../../data');
