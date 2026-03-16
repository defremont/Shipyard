import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeConfig, ChatMessage } from '../types/index.js';
import { DATA_DIR } from './dataDir.js';

const CONFIG_FILE = join(DATA_DIR, 'claude.json');
const ENCRYPTION_KEY_FILE = join(DATA_DIR, '.claude-key');

// Encryption helpers using AES-256-GCM
async function getEncryptionKey(): Promise<Buffer> {
  try {
    const keyHex = await readFile(ENCRYPTION_KEY_FILE, 'utf-8');
    return Buffer.from(keyHex.trim(), 'hex');
  } catch {
    const key = randomBytes(32);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ENCRYPTION_KEY_FILE, key.toString('hex'), 'utf-8');
    return key;
  }
}

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(data: string, key: Buffer): string {
  const [ivHex, tagHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

export async function loadClaudeConfig(): Promise<ClaudeConfig | null> {
  try {
    const data = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
    const key = await getEncryptionKey();
    return {
      apiKey: decrypt(data.apiKey, key),
      model: data.model || 'claude-sonnet-4-5-20250929',
      maxTokens: data.maxTokens || 4096,
    };
  } catch {
    return null;
  }
}

export async function saveClaudeConfig(config: ClaudeConfig): Promise<void> {
  const key = await getEncryptionKey();
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify({
    apiKey: encrypt(config.apiKey, key),
    model: config.model,
    maxTokens: config.maxTokens,
  }, null, 2), 'utf-8');
}

export async function deleteClaudeConfig(): Promise<void> {
  const { unlink } = await import('fs/promises');
  try { await unlink(CONFIG_FILE); } catch {}
}

export async function testApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Invalid API key' };
  }
}

function createClient(config: ClaudeConfig, timeout?: number): Anthropic {
  return new Anthropic({ apiKey: config.apiKey, timeout: timeout ?? 120_000 });
}

export async function* streamChat(
  config: ClaudeConfig,
  messages: ChatMessage[],
  systemPrompt: string,
): AsyncGenerator<string> {
  const client = createClient(config);

  const stream = client.messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

// Fast model for structured output tasks (analyze, bulk organize)
const FAST_MODEL = 'claude-haiku-4-5-20251001';

export async function analyzeTask(
  config: ClaudeConfig,
  projectContext: string,
  taskTitle: string,
  existingDescription?: string,
): Promise<{ title: string; description: string; prompt: string }> {
  // Short timeout — Haiku should respond in a few seconds
  const client = createClient(config, 20_000);

  const userMessage = existingDescription
    ? `Improve this task:\nTitle: ${taskTitle}\nDescription: ${existingDescription}\n\nReturn improved title, description, and technical prompt.`
    : `Analyze this task:\nTitle: ${taskTitle}\n\nReturn improved title, description, and technical prompt.`;

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 1024,
    system: `You are a developer improving task descriptions. Project context: ${projectContext}\n\nRespond ONLY with JSON: { "title": "concise action-oriented title", "description": "what needs to be done", "prompt": "technical details, files, approach" }\nNo markdown fences. Keep it concise.`,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const parsed = parseJsonFromAiResponse(text);
    return {
      title: parsed.title || taskTitle,
      description: parsed.description || '',
      prompt: parsed.prompt || '',
    };
  } catch {
    return { title: taskTitle, description: text, prompt: '' };
  }
}

/** Robust JSON extraction: handles markdown fences, leading text, etc. */
function parseJsonFromAiResponse(text: string): any {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}

  // Strip markdown fences
  const fenceStripped = trimmed.replace(/^```(?:json)?\s*\n?/gim, '').replace(/\n?```\s*$/gim, '').trim();
  try { return JSON.parse(fenceStripped); } catch {}

  // Extract from code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Find first { or [ and match to last } or ] (greedy extraction)
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{' || trimmed[i] === '[') {
      const closingChar = trimmed[i] === '{' ? '}' : ']';
      const lastClose = trimmed.lastIndexOf(closingChar);
      if (lastClose > i) {
        try { return JSON.parse(trimmed.substring(i, lastClose + 1)); } catch {}
      }
    }
  }

  // Try bracket-depth extraction + fix common issues (trailing commas, unquoted keys)
  const jsonCandidate = extractBracketedJson(trimmed);
  if (jsonCandidate) {
    const fixed = jsonCandidate
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    try { return JSON.parse(fixed); } catch {}
  }

  const snippet = trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
  throw new Error(`Could not parse JSON from AI response. Response starts with: ${snippet}`);
}

/** Extract the outermost { ... } or [ ... ] using bracket depth counting */
function extractBracketedJson(text: string): string | null {
  let start = -1;
  let openChar = '';
  let closeChar = '';
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i;
        openChar = ch;
        closeChar = ch === '{' ? '}' : ']';
        depth = 1;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }
  return null;
}

export async function manageTasks(
  config: ClaudeConfig,
  systemInstructions: string,
  rawText: string,
): Promise<{ actions: any[]; summary: string }> {
  const client = createClient(config);

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: config.maxTokens,
    system: systemInstructions,
    messages: [{ role: 'user', content: rawText }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    const parsed = parseJsonFromAiResponse(text);
    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      summary: parsed.summary || '',
    };
  } catch {
    return { actions: [], summary: 'Failed to parse AI response' };
  }
}

export async function bulkOrganizeTasks(
  config: ClaudeConfig,
  projectContext: string,
  rawText: string,
): Promise<Array<{ title: string; description: string; prompt: string; priority: string; status: string }>> {
  const client = createClient(config);

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: config.maxTokens,
    system: `You are a senior developer organizing tasks for a project. ${projectContext}

Parse the raw text below into structured tasks. The text may be a list (one per line), CSV, bullet points, or free-form notes.

For each task, generate:
- title: Clean, concise task title
- description: User-facing explanation of what needs to be done
- prompt: Technical analysis with implementation details, relevant files, possible approaches
- priority: "urgent", "high", "medium", or "low" (infer from context)
- status: "todo" (default), "in_progress", or "done" (if the text implies it's already resolved)

Respond ONLY with valid JSON array, no markdown fences. Example:
[{"title":"...","description":"...","prompt":"...","priority":"medium","status":"todo"}]`,
    messages: [{ role: 'user', content: rawText }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const parsed = parseJsonFromAiResponse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

