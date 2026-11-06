import './style.css';
import { loadAll } from './assets/loader.ts';
import { initAudio } from './audio.ts';
import { Lobby } from './Lobby.ts';
import { connection } from './connection.ts';
import { NetGame } from './net/NetGame.ts';

const canvasElement = document.getElementById('gameCanvas');
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element #gameCanvas not found');
}
const canvas: HTMLCanvasElement = canvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('Could not get 2D canvas context');
}

const width = window.innerWidth;
const height = window.innerHeight;
canvas.width = width;
canvas.height = height;

function drawLoadingScreen(progress: number, text: string = 'Завантаження...'): void {
  if (!ctx) return;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.font = '24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2 - 40);
  ctx.strokeStyle = 'white';
  ctx.strokeRect(width / 2 - 150, height / 2 - 10, 300, 20);
  ctx.fillStyle = 'green';
  ctx.fillRect(width / 2 - 150, height / 2 - 10, 300 * progress, 20);
}

async function bootstrap(_roomData: { room: string; name: string }): Promise<void> {
  const abortController = new AbortController();
  const audioCtx = new AudioContext();
  const game = new NetGame({ canvas, connection });

  try {
    drawLoadingScreen(0, 'Ініціалізація...');

    const assets = await loadAll('/src/assets/manifest.json', {
      signal: abortController.signal,
      audioCtx,
      onProgress: (ratio) => drawLoadingScreen(ratio, `Завантаження... ${Math.round(ratio * 100)}%`),
    });

    drawLoadingScreen(1, 'Готово! Клікніть для старту');

    window.addEventListener(
      'click',
      () => {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        initAudio();
        game.start(assets);
      },
      { once: true },
    );
  } catch (error: unknown) {
    console.error('Помилка завантаження!', error instanceof Error ? error.message : String(error));
    drawLoadingScreen(0, 'Помилка завантаження (див. консоль).');
  }
}

function initLobby(): void {
  const lobby = new Lobby();
  const uiContainer = document.getElementById('lobby-ui');

  const createButton = document.createElement('button');
  createButton.textContent = 'Створити кімнату';
  createButton.onclick = async (): Promise<void> => {
    const name = prompt('Назва кімнати:', `room_${Math.floor(Math.random() * 1000)}`);
    if (!name) return;
    await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    lobby.refresh();
  };
  uiContainer?.appendChild(createButton);

  lobby.onJoin = (detail) => {
    const { room, name } = detail;
    console.log(`Гравець ${name} увійшов у кімнату ${room}`);

    if (uiContainer) {
      uiContainer.style.display = 'none';
    }

    canvas.style.display = 'block';
    bootstrap(detail);
  };

  lobby.start();
}

initLobby();
