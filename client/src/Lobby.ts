import { connection } from './connection.ts';
import { fetchJson } from './assets/loader.ts';

export interface RoomListItem {
  id: string;
  name: string;
  players: number;
}

export class Lobby extends EventTarget {
  container: HTMLElement | null;
  private pollInterval: number | null = null;
  onJoin: ((detail: { room: string; name: string }) => void) | null = null;

  constructor(containerElement?: HTMLElement | null) {
    super();
    this.container = containerElement || document.getElementById('room-list') || document.querySelector('.lobby');
  }

  async refresh(): Promise<void> {
    try {
      const rooms = await fetchJson<RoomListItem[]>('/api/rooms');
      this.render(rooms);
    } catch (err: unknown) {
      console.error('Помилка завантаження лобі:', err instanceof Error ? err.message : String(err));
    }
  }

  render(rooms: RoomListItem[]): void {
    if (!this.container) return;

    if (rooms.length === 0) {
      this.container.innerHTML = '<p>Немає активних кімнат. Створіть нову!</p>';
      return;
    }

    this.container.innerHTML = '';

    rooms.forEach((room) => {
      const button = document.createElement('button');
      button.className = 'room-button';
      button.textContent = `Увійти: ${room.name} (${room.players} гравців)`;

      button.onclick = (): void => {
        const playerName = prompt("Введіть ваше ім'я:", 'Гравець') || 'Anonymous';

        connection.send({
          type: 'join',
          room: room.id,
          name: playerName,
        });

        console.log(`Відправлено запит на вхід у ${room.name} як ${playerName}`);
        this.stop();

        this.onJoin?.({ room: room.id, name: playerName });
        this.dispatchEvent(
          new CustomEvent('join', {
            detail: { room: room.id, name: playerName },
          }),
        );
      };

      this.container?.appendChild(button);
    });
  }

  start(): void {
    if (this.container) this.container.innerHTML = '<p>Завантаження кімнат...</p>';
    this.refresh();
    this.pollInterval = window.setInterval(() => this.refresh(), 2000);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
