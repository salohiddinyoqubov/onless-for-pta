import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  window.setTimeout(() => {
    callback(performance.now());
  }, 0);

globalThis.cancelAnimationFrame = (handle: number) => {
  window.clearTimeout(handle);
};
