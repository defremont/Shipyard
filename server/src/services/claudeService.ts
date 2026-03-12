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

function createClient(config: ClaudeConfig): Anthropic {
  return new Anthropic({ apiKey: config.apiKey });
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

export async function analyzeTask(
  config: ClaudeConfig,
  projectContext: string,
  taskTitle: string,
  existingDescription?: string,
): Promise<{ description: string; prompt: string }> {
  const client = createClient(config);

  const userMessage = existingDescription
    ? `Analyze this task and improve/generate the fields:\n\nTitle: ${taskTitle}\nCurrent description: ${existingDescription}\n\nGenerate an improved description (user-facing, what needs to be done) and a detailed technical prompt (implementation details, files, solutions).`
    : `Analyze this task and generate the fields:\n\nTitle: ${taskTitle}\n\nGenerate a description (user-facing, what needs to be done) and a detailed technical prompt (implementation details, possible approaches, relevant files).`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: `You are a senior developer analyzing tasks for a project. ${projectContext}\n\nRespond in JSON format: { "description": "...", "prompt": "..." }\n- description: Clear, user-facing explanation of what needs to be done\n- prompt: Technical analysis with implementation details, relevant files, possible solutions\n\nRespond ONLY with valid JSON, no markdown fences.`,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const parsed = JSON.parse(text);
    return {
      description: parsed.description || '',
      prompt: parsed.prompt || '',
    };
  } catch {
    return { description: text, prompt: '' };
  }
}

export async function bulkOrganizeTasks(
  config: ClaudeConfig,
  projectContext: string,
  rawText: string,
): Promise<Array<{ title: string; description: string; prompt: string; priority: string; status: string }>> {
  const client = createClient(config);

  const response = await client.messages.create({
    model: config.model,
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
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function summarizeTasks(
  config: ClaudeConfig,
  projectName: string,
  tasks: Array<{ title: string; status: string; priority: string; description: string }>,
): Promise<string> {
  const client = createClient(config);

  const taskList = tasks.map(t => `- [${t.status}] (${t.priority}) ${t.title}: ${t.description}`).join('\n');

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: `Summarize the current state of tasks for project "${projectName}". Be concise and actionable. Highlight priorities and blockers.`,
    messages: [{ role: 'user', content: `Tasks:\n${taskList}` }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
