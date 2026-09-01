/**
 * Iterate the `data:` payloads of an SSE response body, parsed as JSON.
 * Partial or non-JSON lines are skipped — providers pad streams with comments
 * and keep-alives, and a half-received line arrives again on the next chunk.
 *
 * `onActivity` is called for every chunk so callers can reset an idle timeout.
 */
export async function* iterateSseJson(
  body: AsyncIterable<Uint8Array>,
  onActivity?: () => void,
): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    onActivity?.();
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        yield JSON.parse(payload);
      } catch {
        // Malformed or truncated line — the rest arrives in the next chunk.
      }
    }
  }
}

/** Read an error body and turn a non-2xx response into a status-carrying Error. */
export async function httpError(response: Response, provider: string): Promise<Error> {
  const body = await response.text().catch(() => '');
  const message = response.status === 429
    ? `Rate limit reached on ${provider}. Wait a moment and try again.`
    : `${provider} API error ${response.status}: ${body.slice(0, 200)}`;
  const err = new Error(message);
  (err as any).status = response.status;
  return err;
}
