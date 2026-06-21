import type { api } from "./index";

declare global {
  interface Window {
    m3uMixer: typeof api;
  }
}

export {};
