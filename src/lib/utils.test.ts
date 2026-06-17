import {describe, expect, it} from 'vitest';
import {cn} from './utils';

describe('cn', () => {
  it('combina classes condicionais', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('resolve conflitos de classes tailwind mantendo a ultima', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4');
  });
});
