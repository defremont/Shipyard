import type { AiProvider } from '@/lib/api'

export interface AiProviderMeta {
  label: string
  /** Command that provides the free, subscription-backed path. */
  cliCommand: string
  cliInstall: string
  /** What signing in to the CLI gets you. */
  cliBlurb: string
  keyUrl: string
  keyLabel: string
  keyPlaceholder: string
  models: { value: string; label: string }[]
}

export const AI_PROVIDER_ORDER: AiProvider[] = ['claude', 'openai', 'gemini']

export const AI_PROVIDERS: Record<AiProvider, AiProviderMeta> = {
  claude: {
    label: 'Claude',
    cliCommand: 'claude',
    cliInstall: 'npm i -g @anthropic-ai/claude-code',
    cliBlurb: 'Runs on your Claude Pro/Max subscription — no per-token cost.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'console.anthropic.com',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { value: 'claude-opus-4-5-20250514', label: 'Claude Opus 4.5' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    label: 'OpenAI',
    cliCommand: 'codex',
    cliInstall: 'npm i -g @openai/codex',
    cliBlurb: 'Runs on your ChatGPT plan through the Codex CLI.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'platform.openai.com',
    keyPlaceholder: 'sk-...',
    models: [
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'o4-mini', label: 'o4-mini' },
    ],
  },
  gemini: {
    label: 'Gemini',
    cliCommand: 'gemini',
    cliInstall: 'npm i -g @google/gemini-cli',
    cliBlurb: 'Runs on your Google account through the Gemini CLI.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'aistudio.google.com',
    keyPlaceholder: 'AIza...',
    models: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
}

export const BACKEND_LABELS: Record<string, string> = {
  'cli-oauth': 'CLI (subscription)',
  cli: 'CLI',
  api: 'API key',
}
