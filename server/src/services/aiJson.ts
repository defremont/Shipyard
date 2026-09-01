// Structured-output parsing shared by every AI feature.
//
// Models are asked for bare JSON but do not always comply, and each provider
// misbehaves differently: Claude adds a sentence of preamble, OpenAI wraps the
// payload in ```json fences, Gemini sometimes leads with a <thinking> block.
// This walks from strictest to loosest instead of trusting any one shape.

/** Strip reasoning wrappers some models emit before the answer. */
function stripReasoning(text: string): string {
  return text
    .replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .trim();
}

/** Extract the outermost { ... } or [ ... ] using bracket depth counting. */
export function extractBracketedContent(text: string): string | null {
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
    // Skip characters inside strings
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped chars
        i++;
      }
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

/** Parse a model response as JSON, tolerating fences, prose and stray commas. */
export function parseJsonResponse(text: string): any {
  const trimmed = stripReasoning(text.trim());

  // 1. Direct parse
  try { return JSON.parse(trimmed); } catch {}

  // 2. Strip markdown fences and try again
  const fenceStripped = trimmed.replace(/^```(?:json)?\s*\n?/gim, '').replace(/\n?```\s*$/gim, '').trim();
  try { return JSON.parse(fenceStripped); } catch {}

  // 3. Extract JSON from between code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 4. Balanced bracket extraction — survives prose on both sides
  const bracketed = extractBracketedContent(trimmed);
  if (bracketed) {
    try { return JSON.parse(bracketed); } catch {}
  }

  // 5. Greedy span from the first opener to the last matching closer
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{' || trimmed[i] === '[') {
      const closingChar = trimmed[i] === '{' ? '}' : ']';
      const lastClose = trimmed.lastIndexOf(closingChar);
      if (lastClose > i) {
        try { return JSON.parse(trimmed.substring(i, lastClose + 1)); } catch {}
      }
      break;
    }
  }

  // 6. Repair the usual damage: trailing commas and unquoted keys
  if (bracketed) {
    const fixed = bracketed
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
    try { return JSON.parse(fixed); } catch {}
  }

  const snippet = trimmed.length > 200 ? `${trimmed.substring(0, 200)}...` : trimmed;
  throw new Error(`Could not parse JSON from AI response. Response starts with: ${snippet}`);
}
