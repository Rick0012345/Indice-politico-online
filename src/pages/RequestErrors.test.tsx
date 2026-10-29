import React from 'react';
import {screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {Camara} from './Camara';
import {Ranking} from './Ranking';
import {Home} from './Home';
import {Partidos} from './Partidos';
import {ProposicaoDetail} from './ProposicaoDetail';
import {Routes, Route} from 'react-router-dom';
afterEach(()=>vi.unstubAllGlobals());
it.each([['Câmara', Camara],['Ranking',Ranking],['Início',Home],['Partidos',Partidos]])('informa falha HTTP em %s',async(_name,Page)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:500} as Response)));
 renderWithProviders(<Page/>);
 expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Não foi possível carregar');
});

it('distingue falha HTTP de proposição ausente',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:500} as Response)));
 renderWithProviders(<Routes><Route path='/proposicao/:id' element={<ProposicaoDetail/>}/></Routes>,{route:'/proposicao/1'});
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a proposição');
 expect(screen.queryByText('Proposicao nao encontrada.')).not.toBeInTheDocument();
});
