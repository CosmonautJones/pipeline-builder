import type { ClarificationQuestion, ParsedIntent } from "../types/agent.js";
import { generateConversationId } from "../utils/id.js";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationState {
  id: string;
  messages: ConversationMessage[];
  parsedIntent?: ParsedIntent;
  pendingQuestions: ClarificationQuestion[];
  answeredQuestions: Map<string, string>;
  isComplete: boolean;
}

/**
 * Manages a conversation session between the pipeline builder and the user.
 * Tracks messages, questions, and parsed intent.
 */
export class ConversationSession {
  private state: ConversationState;

  constructor(id?: string) {
    this.state = {
      id: id ?? generateConversationId(),
      messages: [],
      pendingQuestions: [],
      answeredQuestions: new Map(),
      isComplete: false,
    };
  }

  get id(): string {
    return this.state.id;
  }

  // ── Message management ──────────────────────────────────────────

  addUserMessage(content: string): void {
    this.state.messages.push({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(content: string, metadata?: Record<string, unknown>): void {
    this.state.messages.push({
      role: "assistant",
      content,
      timestamp: Date.now(),
      metadata,
    });
  }

  addSystemMessage(content: string): void {
    this.state.messages.push({
      role: "system",
      content,
      timestamp: Date.now(),
    });
  }

  getMessages(): ConversationMessage[] {
    return [...this.state.messages];
  }

  getLastUserMessage(): string | undefined {
    const userMsgs = this.state.messages.filter(m => m.role === "user");
    return userMsgs[userMsgs.length - 1]?.content;
  }

  // ── Intent ──────────────────────────────────────────────────────

  setIntent(intent: ParsedIntent): void {
    this.state.parsedIntent = intent;
  }

  getIntent(): ParsedIntent | undefined {
    return this.state.parsedIntent;
  }

  // ── Questions ───────────────────────────────────────────────────

  setPendingQuestions(questions: ClarificationQuestion[]): void {
    this.state.pendingQuestions = questions;
  }

  getPendingQuestions(): ClarificationQuestion[] {
    return this.state.pendingQuestions;
  }

  answerQuestion(questionId: string, answer: string): void {
    this.state.answeredQuestions.set(questionId, answer);
    this.state.pendingQuestions = this.state.pendingQuestions.filter(q => q.id !== questionId);
  }

  answerAllPending(answers: Record<string, string>): void {
    for (const [id, answer] of Object.entries(answers)) {
      this.answerQuestion(id, answer);
    }
  }

  getAnswers(): Record<string, string> {
    return Object.fromEntries(this.state.answeredQuestions);
  }

  hasPendingQuestions(): boolean {
    return this.state.pendingQuestions.length > 0;
  }

  // ── Session state ───────────────────────────────────────────────

  complete(): void {
    this.state.isComplete = true;
  }

  get isComplete(): boolean {
    return this.state.isComplete;
  }

  toContext(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.state.messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  toJSON(): Record<string, unknown> {
    return {
      ...this.state,
      answeredQuestions: Object.fromEntries(this.state.answeredQuestions),
    };
  }
}
