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

// Structured-output helpers (analyze, bulk organize, manage tasks) moved to
// aiBackend.ts, which routes them through the CLI-first backend chain.

