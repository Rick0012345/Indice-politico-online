import React from 'react';
import {describe, expect, it} from 'vitest';
import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ThemeProvider, useTheme} from './ThemeContext';
import {render} from '@testing-library/react';

const ThemeProbe = () => {
  const {theme, toggleTheme} = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      Tema atual: {theme}
    </button>
  );
};

describe('ThemeProvider', () => {
  it('usa o tema salvo e aplica a classe dark', () => {
    localStorage.setItem('theme', 'dark');

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', {name: 'Tema atual: dark'})).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('alterna entre tema claro e escuro', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', {name: 'Tema atual: light'})).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Tema atual: light'}));

    expect(screen.getByRole('button', {name: 'Tema atual: dark'})).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
