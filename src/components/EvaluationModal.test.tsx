import React from 'react';
import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {EvaluationModal} from './EvaluationModal';
import {renderWithProviders} from '../test/render';

const renderModal = (props?: Partial<React.ComponentProps<typeof EvaluationModal>>) => {
  return renderWithProviders(
    <EvaluationModal
      isOpen
      onClose={vi.fn()}
      politicoId="dep-123"
      politicoName="Maria Silva"
      {...props}
    />,
  );
};

describe('EvaluationModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nao renderiza quando esta fechado', () => {
    renderWithProviders(
      <EvaluationModal isOpen={false} onClose={vi.fn()} politicoId="dep-123" politicoName="Maria Silva" />,
    );

    expect(screen.queryByText('Avaliar Politico')).not.toBeInTheDocument();
  });

  it('mantem envio bloqueado ate ter nota e CPF completo', async () => {
    const user = userEvent.setup();
    renderModal();

    const confirmButton = screen.getByRole('button', {name: 'Confirmar voto'});
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole('button', {name: 'Dar 4 estrelas'}));
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('CPF para validar o voto'), '52998224725');
    expect(screen.getByLabelText('CPF para validar o voto')).toHaveValue('529.982.247-25');
    expect(confirmButton).toBeEnabled();
  });

  it('envia avaliacao e notifica a pagina quando a API responde com sucesso', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEvaluationSaved = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        action: 'updated',
        message: 'Avaliacao atualizada.',
        notaMedia: 4.5,
        totalAvaliacoes: 12,
      }),
    } as Response);

    renderModal({onClose, onEvaluationSaved});

    await user.click(screen.getByRole('button', {name: 'Dar 5 estrelas'}));
    await user.type(screen.getByLabelText('CPF para validar o voto'), '52998224725');
    await user.type(screen.getByLabelText('Comentario (opcional)'), '  Bom mandato  ');
    await user.click(screen.getByRole('button', {name: 'Confirmar voto'}));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/politicos/dep-123/avaliacoes', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          cpf: '52998224725',
          nota: 5,
          comentario: 'Bom mandato',
        }),
      });
    });

    expect(onEvaluationSaved).toHaveBeenCalledWith({
      action: 'updated',
      notaMedia: 4.5,
      totalAvaliacoes: 12,
    });
    expect(screen.getByText('Avaliacao atualizada.')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), {timeout: 1500});
  });

  it('mostra erro retornado pela API sem fechar o modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({error: 'CPF invalido. Confira os numeros e tente novamente.'}),
    } as Response);

    renderModal({onClose});

    await user.click(screen.getByRole('button', {name: 'Dar 3 estrelas'}));
    await user.type(screen.getByLabelText('CPF para validar o voto'), '52998224725');
    await user.click(screen.getByRole('button', {name: 'Confirmar voto'}));

    expect(await screen.findByText('CPF invalido. Confira os numeros e tente novamente.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mostra erro de conexao quando a chamada falha', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network'));

    renderModal();

    await user.click(screen.getByRole('button', {name: 'Dar 2 estrelas'}));
    await user.type(screen.getByLabelText('CPF para validar o voto'), '52998224725');
    await user.click(screen.getByRole('button', {name: 'Confirmar voto'}));

    expect(await screen.findByText('Falha de conexao. Tente novamente em instantes.')).toBeInTheDocument();
  });
});
