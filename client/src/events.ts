export type Handler<T> = (data: T) => void;

export class Bus<Events extends object> {
  private readonly handlers: { [K in keyof Events]?: Set<Handler<never>> } = {};

  on<K extends keyof Events & string>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers[event];
    if (!set) {
      set = new Set<Handler<never>>();
      this.handlers[event] = set;
    }
    const h = handler as Handler<never>; // Justified cast: register event handler in bus
    set.add(h);
    return () => {
      set.delete(h);
    };
  }

  emit<K extends keyof Events & string>(event: K, data: Events[K]): void {
    const set = this.handlers[event];
    if (set) {
      for (const h of set) {
        (h as Handler<Events[K]>)(data); // Justified cast: invoke typed event handler
      }
    }
  }

  addEventListener<K extends keyof Events & string>(event: K, listener: (data: Events[K]) => void): void {
    this.on(event, listener);
  }

  dispatchEvent<K extends keyof Events & string>(event: K, data: Events[K]): void {
    this.emit(event, data);
  }
}

export interface GameEvents {
  fired: void;
  hit: { id: number; damage: number };
  player_joined: { name: string };
  player_left: { name: string };
  game_over: { winner: string };
}

export const eventBus: Bus<GameEvents> = new Bus<GameEvents>();
