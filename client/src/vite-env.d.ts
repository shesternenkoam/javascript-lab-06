/// <reference types="vite/client" />

declare interface Window {
  simSelfTest?: (steps?: number, seed?: number) => number;
}
