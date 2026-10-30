import '@testing-library/jest-dom/vitest';
import React from 'react';
import {afterEach, vi} from 'vitest';
import {cleanup} from '@testing-library/react';
import {clearCatalogResources} from '../lib/catalogResource';

afterEach(() => {
  cleanup();
  clearCatalogResources();
  vi.clearAllMocks();
  vi.useRealTimers();
  if (typeof window !== 'undefined') {
    localStorage.clear();
    document.documentElement.className = '';
  }
});

if (typeof window !== 'undefined') Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('motion/react', () => ({
  AnimatePresence: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  motion: {
    div: ({children, ...props}: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement('div', props, children),
  },
}));
