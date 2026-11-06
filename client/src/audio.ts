import { eventBus } from './events.ts';

const shootAudio = new Audio('/shoot.mp3');

function playSound(name: string): void {
  if (name === 'shoot') {
    shootAudio.currentTime = 0;
    shootAudio.play().catch((_err: unknown) => {});
  }
}

export function initAudio(): void {
  eventBus.addEventListener('fired', () => playSound('shoot'));
}
