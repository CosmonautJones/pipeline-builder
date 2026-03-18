import { EventEmitter } from "node:events";
import type { ExecutionEvent } from "../types/execution.js";
import type { AgentMessage } from "../types/agent.js";

type EventMap = {
  "execution": ExecutionEvent;
  "agent-message": AgentMessage;
  "log": { level: string; message: string; meta?: Record<string, unknown> };
};

export class TypedEventBus {
  private emitter = new EventEmitter();

  on<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
  }

  once<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.once(event, listener);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
