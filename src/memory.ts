import type { StoredMessage } from "./types";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function trimMessagesToBudget(
  messages: StoredMessage[],
  maxTokens: number,
  reservedForReply = 512,
): StoredMessage[] {
  const budget = maxTokens - reservedForReply;
  if (budget <= 0) {
    return messages.slice(-1);
  }

  const kept: StoredMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = msg.tokens ?? estimateTokens(msg.content);
    if (kept.length > 0 && total + cost > budget) break;
    kept.push(msg);
    total += cost;
  }
  kept.reverse();
  return kept;
}
