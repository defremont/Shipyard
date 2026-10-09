import { DEFAULT_SECTIONS, type ReportSections } from '@/components/reports/reportTemplates'

/** ReportDialog configuration that a preset stores. The date range itself is not saved — only whether it is on. */
export interface ReportPresetConfig {
  title: string
  clientName: string
  usePeriod: boolean
  sections: ReportSections
  includeCommits: boolean
  includeTech: boolean
}

export type ReportPresets = Record<string, ReportPresetConfig>

const presetsKey = (projectId: string) => `shipyard:report-presets:${projectId}`
const lastPresetKey = (projectId: string) => `shipyard:report-presets:${projectId}:last`
const cursorKey = (projectId: string) => `shipyard:report-cursor:${projectId}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Stored data may be hand-edited or from an older build: keep what has the right type, default the rest.
function normalizePreset(raw: unknown): ReportPresetConfig | null {
  if (!isRecord(raw)) return null
  const rawSections = isRecord(raw.sections) ? raw.sections : {}
  const sections = { ...DEFAULT_SECTIONS }
  for (const k of Object.keys(sections) as Array<keyof ReportSections>) {
    if (typeof rawSections[k] === 'boolean') sections[k] = rawSections[k] as boolean
  }
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    clientName: typeof raw.clientName === 'string' ? raw.clientName : '',
    usePeriod: raw.usePeriod === true,
    sections,
    includeCommits: raw.includeCommits === true,
    includeTech: raw.includeTech === true,
  }
}

export function readReportPresets(projectId: string): ReportPresets {
  const raw = read(presetsKey(projectId))
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const entries: Array<[string, ReportPresetConfig]> = []
    for (const [name, value] of Object.entries(parsed)) {
      const preset = normalizePreset(value)
      if (preset) entries.push([name, preset])
    }
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

export function writeReportPresets(projectId: string, presets: ReportPresets): boolean {
  return write(presetsKey(projectId), JSON.stringify(presets))
}

export function readLastReportPreset(projectId: string): string | null {
  return read(lastPresetKey(projectId))
}

export function writeLastReportPreset(projectId: string, name: string | null): void {
  write(lastPresetKey(projectId), name)
}

/** ISO timestamp of the last "Mark as reported", or null when missing or unparseable. */
export function readReportCursor(projectId: string): string | null {
  const raw = read(cursorKey(projectId))
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null
}

export function writeReportCursor(projectId: string, iso: string): boolean {
  return write(cursorKey(projectId), iso)
}
