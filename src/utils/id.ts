import { nanoid } from "nanoid";

export function generateId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateExecutionId(): string {
  return generateId("exec");
}

export function generateConversationId(): string {
  return generateId("conv");
}

export function generateMessageId(): string {
  return generateId("msg");
}
