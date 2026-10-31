import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {act, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {renderWithProviders} from '../../test/render';
import {BrazilTileMap, PanoramaStrip, PartySpendingBars} from './HomePanels';

afterEach(() => vi.unstubAllGlobals());
const data = {
  panorama: {total: 3, totalCadastrados: 4, totalDespesas: 900},
  estados: [{uf: 'SP', totalPoliticos: 2, totalDespesas: 800}, {uf: 'RJ', totalPoliticos: 1, totalDespesas: 100}],
  partidos: [{partido: 'ABC', totalPoliticos: 2, totalDespesas: 800}, {partido: 'XYZ', totalPoliticos: 1, totalDespesas: 100}],
};
it('distingue falha de carregamento de ausência de despesas', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 500}) as Response));
  renderWithProviders(<PartySpendingBars/>);
  expect(await screen.findByText('Não foi possível carregar os gastos por partido.')).toBeVisible();
  expect(screen.queryByText('Sem despesas por partido ainda')).not.toBeInTheDocument();
});
it('carrega os três painéis com uma consulta e mantém os modos de comparação', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => ({ok: true, json: async () => data}) as Response);
  vi.stubGlobal('fetch', fetcher);
  renderWithProviders(<><PanoramaStrip/><BrazilTileMap/><PartySpendingBars/></>);
  expect(await screen.findByText('ABC')).toBeVisible();
  expect(screen.getByText('900', {exact: false})).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/home/resumo');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', {name: 'Tamanho da bancada'}));
  await user.click(screen.getByRole('button', {name: 'Por deputado'}));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', {name: 'Tamanho da bancada'})).toHaveAttribute('aria-pressed', 'true');
});
it('desmontar um consumidor não cancela os painéis restantes', async () => {
  let finish!: (value: Response) => void;
  let signal: AbortSignal;
  const fetcher = vi.fn((_input, init) => {
    signal = init.signal;
    return new Promise<Response>(resolve => {finish = resolve;});
  });
  vi.stubGlobal('fetch', fetcher);
  const {rerender} = render(<><PanoramaStrip key="panorama"/><PartySpendingBars key="partidos"/></>, {wrapper: MemoryRouter});
  rerender(<><PartySpendingBars key="partidos"/></>);
  await act(async () => {finish({ok: true, json: async () => data} as Response);});
  expect(signal!.aborted).toBe(false);
  expect(await screen.findByText('ABC')).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
