export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface Bus {
  emit(event: GameEvent): void;
  on(handler: (event: GameEvent) => void): () => void;
}

export function createBus(): Bus {
  const handlers = new Set<(event: GameEvent) => void>();
  return {
    emit(event) {
      for (const h of handlers) h(event);
    },
    on(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
