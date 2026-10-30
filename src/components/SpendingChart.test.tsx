import React from 'react';
import {screen, within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {SpendingChart} from './SpendingChart';

vi.mock('recharts', async()=>{
 const original=await vi.importActual<typeof import('recharts')>('recharts');
 return {...original,ResponsiveContainer:({children}:{children:React.ReactElement<{width:number;height:number}>})=>React.cloneElement(children,{width:600,height:280})};
});

it('explica universo, filtro e preserva sinal de valores negativos no gráfico',()=>{
 renderWithProviders(<SpendingChart nomePolitico="Maria" scopeLabel="Ano 2026 · Combustível" resumo={[{ano:2026,mes:1,total:-1500},{ano:2026,mes:2,total:1000}]} media={[{ano:2026,mes:1,media:200,participantes:7},{ano:2026,mes:2,media:100,participantes:3}]}/>);
 expect(screen.getByText(/Média dos parlamentares com despesas registradas no mesmo filtro e mês/)).toBeInTheDocument();
 expect(screen.getByText('Escopo: Ano 2026 · Combustível')).toBeInTheDocument();
 expect(screen.getByText('Jan/26: 7 parlamentares')).toBeInTheDocument();
 expect(screen.getByText('Fev/26: 3 parlamentares')).toBeInTheDocument();
 const legend = screen.getByRole('list',{name:'Legenda dos gastos mensais'});
 expect(within(legend).getByText('Maria')).toBeInTheDocument();
 expect(within(legend).getByText('Média dos parlamentares com registros')).toBeInTheDocument();
 expect(screen.getAllByText(/-R\$/).length).toBeGreaterThan(0);
});
