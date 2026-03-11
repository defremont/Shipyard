import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Settings } from '../types/index.js';
import { DATA_DIR } from './dataDir.js';

const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS: Settings = {
  selectedProjects: [],
};

let settings: Settings = { ...DEFAULT_SETTINGS };

export async function loadSettings(): Promise<Settings> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    settings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

export async function saveSettings(newSettings: Settings): Promise<Settings> {
  settings = newSettings;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

export function getSettings(): Settings {
  return settings;
}
