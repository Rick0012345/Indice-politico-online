import React from 'react';
import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {CurrentIngestionRun} from './CurrentIngestionRun';
import {IngestionProgressSummary} from './IngestionProgressSummary';
import type {IngestionRunProgress, RunTaskProgress} from '../lib/ingestionRunTypes';

const totals: RunTaskProgress = {estimatedTotal:100, completed:25, reused:10, remaining:75, running:1, pending:24, failed:0, cancelled:0, notCreated:50, percent:25};
const run: IngestionRunProgress = {
  ...totals, id:'run-1', from:'2025-01-01', to:'2026-10-31', datasets:['deputados','despesas'],
  startedAt:'2026-10-31T12:00:00Z', updatedAt:'2026-10-31T12:01:00Z', finishedAt:null,
  status:'running', currentDataset:'deputados', estimationComplete:true,
  byDataset:[
    {...totals, dataset:'deputados', stage:'running', estimatedTotal:50, remaining:25, notCreated:0, percent:50},
    {...totals, dataset:'despesas', stage:'waiting', estimatedTotal:50, completed:0, reused:0, remaining:50, running:0, pending:0, notCreated:50, percent:0},
  ],
};

describe('progresso da execução atual', () => {
  it('expõe estimado, concluídas, restantes e percentual incluindo conjuntos futuros', () => {
    render(<CurrentIngestionRun currentRun={run} />);
    const bar = screen.getByRole('progressbar', {name:'Progresso da ingestão atual'});
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar).toHaveAttribute('aria-valuetext', '25%: 25 de 100 tarefas concluídas; 75 restantes');
    expect(screen.getByText('Etapa atual: Deputados')).toBeInTheDocument();
    expect(screen.getByText('01/01/2025 a 31/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Coletas selecionadas: Deputados, Despesas')).toBeInTheDocument();
    const future = screen.getByRole('region', {name:'Conjunto Despesas'});
    expect(future).toHaveTextContent('Aguardando etapa');
    expect(within(future).getByRole('progressbar')).toHaveAttribute('aria-valuemax', '50');
    expect(future).toHaveTextContent('50 ainda não criadas');
  });

  it('identifica as concluídas reaproveitadas sem somá-las novamente', () => {
    render(<CurrentIngestionRun currentRun={run} />);
    expect(screen.getByText('10 das 25 concluídas já estavam prontas na base e foram reaproveitadas.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow', '25');
  });

  it('não inventa porcentagem quando não há planejamento', () => {
    render(<CurrentIngestionRun currentRun={null} />);
    expect(screen.getByText(/Ainda não há planejamento registrado/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('identifica estimativa provisória sem total conhecido como em descoberta', () => {
    const zero = {estimatedTotal:0, completed:0, reused:0, remaining:0, running:0, pending:0, failed:0, cancelled:0, notCreated:0, percent:0};
    render(<CurrentIngestionRun currentRun={{...run, ...zero, estimationComplete:false, byDataset:[]}} />);
    expect(screen.getByText('Estimativa provisória')).toBeInTheDocument();
    expect(screen.getByText(/O total pode mudar/)).toBeInTheDocument();
    expect(screen.getByText('Estimativa em descoberta')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('mantém o denominador conhecido enquanto a estimativa é provisória', () => {
    render(<CurrentIngestionRun currentRun={{...run, estimationComplete:false}} />);
    expect(screen.getByText('Estimativa provisória')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuetext', '25%: 25 de 100 tarefas concluídas; 75 restantes');
  });

  it('diferencia total zero consolidado de estimativa em descoberta', () => {
    render(<CurrentIngestionRun currentRun={{...run, estimatedTotal:0, completed:0, remaining:0, estimationComplete:true, byDataset:[]}} />);
    expect(screen.getByText('Nenhuma tarefa prevista neste escopo')).toBeInTheDocument();
    expect(screen.queryByText('Estimativa em descoberta')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('não arredonda um total grande incompleto para cem por cento', () => {
    render(<CurrentIngestionRun currentRun={{...run, estimatedTotal:10000000, completed:9999999, remaining:1, percent:99.99999}} />);
    const bar = screen.getByRole('progressbar', {name:'Progresso da ingestão atual'});
    expect(bar).toHaveAttribute('aria-valuemax', '10000000');
    expect(bar).toHaveAttribute('aria-valuetext', '99,99%: 9.999.999 de 10.000.000 tarefas concluídas; 1 restantes');
  });

  it.each([['failed','Com falha'], ['cancelled','Cancelada'], ['interrupted','Interrompida'], ['completed','Finalizada com pendências']] as const)('identifica a última execução %s sem transformar restantes em sucesso', (status, label) => {
    render(<CurrentIngestionRun currentRun={{...run, status, currentDataset:null, finishedAt:run.updatedAt, failed:20, cancelled:5}} />);
    expect(screen.getByRole('heading', {name:'Última execução'})).toBeInTheDocument();
    expect(screen.getByText(label, {exact:true})).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow','25');
    expect(screen.getByText('20 com falha · 5 canceladas')).toBeInTheDocument();
    expect(screen.queryByText('Em processamento', {exact:true})).not.toBeInTheDocument();
  });

  it('reserva Concluída para a execução finalizada sem tarefas restantes', () => {
    render(<CurrentIngestionRun currentRun={{...run, status:'completed', completed:100, remaining:0, percent:100}} />);
    expect(screen.getByText('Concluída', {exact:true})).toBeInTheDocument();
    expect(screen.queryByText('Finalizada com pendências')).not.toBeInTheDocument();
  });

  it('explica que a execução interrompida possui valores observados sem término confirmado', () => {
    render(<CurrentIngestionRun currentRun={{...run, status:'interrupted', finishedAt:null}} />);
    expect(screen.getByText(/O término da execução não foi confirmado/)).toHaveTextContent('valores observados');
  });

  it.each([
    {error:'Sem conexão', lastUpdatedAt:new Date('2026-10-31T12:01:00Z')},
    {error:null, lastUpdatedAt:null},
  ])('identifica a leitura antiga sem confirmar a atividade da execução (%j)', ({error, lastUpdatedAt}) => {
    render(<IngestionProgressSummary currentRun={run} progress={{total:100, done:25, withRecords:25, empty:0, running:1, pending:74, failed:0, percent:25}} execution={{processActive:true, maintenanceActive:true}} lastUpdatedAt={lastUpdatedAt} error={error} />);
    const current = screen.getByRole('region', {name:'Execução atual'});
    expect(within(current).getByRole('heading', {name:'Última leitura'})).toBeInTheDocument();
    expect(current).toHaveTextContent('Estado desatualizado');
    expect(current).not.toHaveTextContent('Em execução');
    expect(current).not.toHaveTextContent('Etapa atual:');
    expect(current).not.toHaveTextContent('Em processamento');
    expect(within(current).getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow','25');
    expect(screen.getByText('Situação geral da fila')).toBeInTheDocument();
  });

  it('atualiza os números com a leitura seguinte e preserva o escopo recebido ao remontar', () => {
    const view = render(<CurrentIngestionRun currentRun={run} />);
    view.rerender(<CurrentIngestionRun currentRun={{...run, completed:50, remaining:50, percent:50}} />);
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow','50');
    view.unmount();
    render(<CurrentIngestionRun currentRun={run} />);
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow','25');
    expect(screen.getByText('01/01/2025 a 31/10/2026')).toBeInTheDocument();
  });

  it('separa o progresso atual do acumulado histórico', () => {
    render(<IngestionProgressSummary currentRun={run} progress={{total:10000, done:9999, withRecords:9999, empty:0, running:1, pending:0, failed:0, percent:99.99}} execution={{processActive:true, maintenanceActive:true}} lastUpdatedAt={new Date()} error={null} />);
    expect(screen.getByRole('region', {name:'Resumo da ingestão'})).toHaveTextContent('Coleta em execução');
    expect(screen.getByRole('progressbar', {name:'Progresso da ingestão atual'})).toHaveAttribute('aria-valuenow','25');
    expect(screen.getByText('Tarefas acumuladas na base').closest('details')).not.toHaveAttribute('open');
  });

  it('não substitui planejamento ausente pelo acumulado mesmo quando o agente está ativo', () => {
    render(<IngestionProgressSummary progress={{total:100, done:99, withRecords:99, empty:0, running:1, pending:0, failed:0, percent:99}} execution={{processActive:true, maintenanceActive:true}} lastUpdatedAt={new Date()} error={null} />);
    expect(screen.getByText(/Ainda não há planejamento registrado/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', {name:'Progresso da ingestão atual'})).not.toBeInTheDocument();
  });
});
