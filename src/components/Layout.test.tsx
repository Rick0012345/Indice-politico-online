import React from 'react';
import {describe, expect, it} from 'vitest';
import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Navbar} from './Layout';
import {renderWithProviders} from '../test/render';

describe('Navbar', () => {
  it('renderiza os links principais e marca a rota atual', () => {
    renderWithProviders(<Navbar />, {route: '/ranking'});

    expect(screen.getByRole('link', {name: /ranking/i})).toHaveClass('text-blue-600');
    expect(screen.getByRole('link', {name: /partidos/i})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /metodologia/i})).toBeInTheDocument();
  });

  it('alterna o tema pelo botao da barra', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Navbar />);

    const themeButton = screen.getByRole('button', {name: 'Ativar modo escuro'});
    await user.click(themeButton);

    expect(screen.getByRole('button', {name: 'Ativar modo claro'})).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('abre e fecha o menu mobile', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Navbar />);

    const openButton = screen.getByRole('button', {name: 'Abrir menu'});
    await user.click(openButton);

    expect(screen.getByRole('button', {name: 'Fechar menu'})).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('link', {name: /ranking/i})).toHaveLength(2);

    await user.click(screen.getByRole('button', {name: 'Fechar menu'}));

    expect(screen.getByRole('button', {name: 'Abrir menu'})).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('link', {name: /ranking/i})).toHaveLength(1);
  });
});
