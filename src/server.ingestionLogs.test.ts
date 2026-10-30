// @vitest-environment node
import {expect, it} from 'vitest';
import {parseIngestionLogStats} from './server';

it('retira do progresso atual as janelas concluídas ou com falha', () => {
  const data = parseIngestionLogStats([
    '[progress] votacoes 2020-01-01..2020-01-31: 1/2 sessoes, 100 registros',
    '[progress] proposicoes 2020-02-01..2020-02-29: 1/2 proposicoes, 15 registros',
    '[ok-items] votacoes  2020-01-01..2020-01-31: 100',
    '[retry] proposicoes  2020-02-01..2020-02-29: falhou',
  ].join('\n'));
  expect(data.progressItems).toBe(0);
  expect(data.okItems).toBe(1);
  expect(data.retries).toBe(1);
});

it('mantém apenas a última quantidade da janela que continua em andamento', () => {
  expect(parseIngestionLogStats([
    '[progress] votacoes 2020-01-01..2020-01-31: 1/2 sessoes, 100 registros',
    '[progress] votacoes 2020-01-01..2020-01-31: 2/2 sessoes, 200 registros',
    '[progress] proposicoes 2020-02-01..2020-02-29: 1/2 proposicoes, 15 registros',
    '[ok-zero] proposicoes  2020-02-01..2020-02-29: 0',
  ].join('\n')).progressItems).toBe(200);
});
