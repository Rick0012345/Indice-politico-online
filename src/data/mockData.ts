import { Politico } from '../types';

export const mockPoliticos: Politico[] = [
  {
    id: '1',
    nome: 'Arthur Lira',
    partido: 'PP',
    estado: 'AL',
    cargo: 'Deputado Federal',
    foto: 'https://picsum.photos/seed/arthur/400/400',
    notaMedia: 2.4,
    presenca: 85,
    alinhamentoGoverno: 92,
    votacoes: [
      { id: 'v1', projeto: 'PL 1234/2023 - Reforma Tributária', voto: 'Sim', data: '2023-11-15' },
      { id: 'v2', projeto: 'PL 5678/2023 - Marco Temporal', voto: 'Sim', data: '2023-09-20' },
      { id: 'v3', projeto: 'PL 9012/2023 - Arcabouço Fiscal', voto: 'Sim', data: '2023-08-10' },
      { id: 'v4', projeto: 'PL 3456/2023 - Lei das Estatais', voto: 'Não', data: '2023-06-05' },
      { id: 'v5', projeto: 'PL 7890/2023 - Saneamento Básico', voto: 'Sim', data: '2023-05-12' },
    ],
    despesas: [
      { id: 'd1', valor: 15400.50, data: '2024-02-10', tipo: 'Divulgação da Atividade Parlamentar' },
      { id: 'd2', valor: 2300.00, data: '2024-02-05', tipo: 'Combustíveis e Lubrificantes' },
      { id: 'd3', valor: 450.75, data: '2024-01-28', tipo: 'Hospedagem' },
    ],
    noticias: [
      { id: 'n1', titulo: 'Lira defende manutenção de desoneração da folha', link: '#', data: '2024-03-01' },
      { id: 'n2', titulo: 'Presidente da Câmara discute pauta econômica com governo', link: '#', data: '2024-02-15' },
    ]
  },
  {
    id: '2',
    nome: 'Tabata Amaral',
    partido: 'PSB',
    estado: 'SP',
    cargo: 'Deputada Federal',
    foto: 'https://picsum.photos/seed/tabata/400/400',
    notaMedia: 4.2,
    presenca: 98,
    alinhamentoGoverno: 75,
    votacoes: [
      { id: 'v1', projeto: 'PL 1234/2023 - Reforma Tributária', voto: 'Sim', data: '2023-11-15' },
      { id: 'v2', projeto: 'PL 5678/2023 - Marco Temporal', voto: 'Não', data: '2023-09-20' },
      { id: 'v3', projeto: 'PL 9012/2023 - Arcabouço Fiscal', voto: 'Sim', data: '2023-08-10' },
      { id: 'v4', projeto: 'PL 3456/2023 - Lei das Estatais', voto: 'Não', data: '2023-06-05' },
      { id: 'v5', projeto: 'PL 7890/2023 - Saneamento Básico', voto: 'Sim', data: '2023-05-12' },
    ],
    despesas: [
      { id: 'd1', valor: 8200.00, data: '2024-02-12', tipo: 'Consultorias e Pesquisas' },
      { id: 'd2', valor: 1100.20, data: '2024-02-01', tipo: 'Manutenção de Escritório' },
      { id: 'd3', valor: 320.00, data: '2024-01-20', tipo: 'Telefonia' },
    ],
    noticias: [
      { id: 'n1', titulo: 'Tabata Amaral lança pré-candidatura à prefeitura de SP', link: '#', data: '2024-01-25' },
      { id: 'n2', titulo: 'Deputada defende maior investimento em educação básica', link: '#', data: '2023-12-10' },
    ]
  },
  {
    id: '3',
    nome: 'Rodrigo Pacheco',
    partido: 'PSD',
    estado: 'MG',
    cargo: 'Senador',
    foto: 'https://picsum.photos/seed/pacheco/400/400',
    notaMedia: 3.8,
    presenca: 92,
    alinhamentoGoverno: 82,
    votacoes: [
      { id: 'v1', projeto: 'PEC 45/2019 - Reforma Tributária', voto: 'Sim', data: '2023-11-08' },
      { id: 'v2', projeto: 'PL 2903/2023 - Marco Temporal', voto: 'Sim', data: '2023-09-27' },
      { id: 'v3', projeto: 'PL 2384/2023 - Voto de Qualidade no CARF', voto: 'Sim', data: '2023-08-30' },
      { id: 'v4', projeto: 'PL 2720/2023 - Discriminação de Políticos', voto: 'Sim', data: '2023-06-15' },
      { id: 'v5', projeto: 'PL 1459/2022 - Lei dos Agrotóxicos', voto: 'Sim', data: '2023-11-28' },
    ],
    despesas: [
      { id: 'd1', valor: 25000.00, data: '2024-02-15', tipo: 'Segurança Privada' },
      { id: 'd2', valor: 5400.00, data: '2024-02-08', tipo: 'Passagens Aéreas' },
      { id: 'd3', valor: 1200.00, data: '2024-01-30', tipo: 'Correios' },
    ],
    noticias: [
      { id: 'n1', titulo: 'Pacheco defende autonomia do Banco Central', link: '#', data: '2024-02-20' },
      { id: 'n2', titulo: 'Presidente do Senado pauta fim da reeleição', link: '#', data: '2024-03-05' },
    ]
  },
  {
    id: '4',
    nome: 'Erika Hilton',
    partido: 'PSOL',
    estado: 'SP',
    cargo: 'Deputada Federal',
    foto: 'https://picsum.photos/seed/erika/400/400',
    notaMedia: 4.5,
    presenca: 95,
    alinhamentoGoverno: 60,
    votacoes: [
      { id: 'v1', projeto: 'PL 1234/2023 - Reforma Tributária', voto: 'Sim', data: '2023-11-15' },
      { id: 'v2', projeto: 'PL 5678/2023 - Marco Temporal', voto: 'Não', data: '2023-09-20' },
    ],
    despesas: [
      { id: 'd1', valor: 5000.00, data: '2024-02-10', tipo: 'Divulgação' },
    ],
    noticias: []
  },
  {
    id: '5',
    nome: 'Nikolas Ferreira',
    partido: 'PL',
    estado: 'MG',
    cargo: 'Deputado Federal',
    foto: 'https://picsum.photos/seed/nikolas/400/400',
    notaMedia: 1.8,
    presenca: 88,
    alinhamentoGoverno: 15,
    votacoes: [
      { id: 'v1', projeto: 'PL 1234/2023 - Reforma Tributária', voto: 'Não', data: '2023-11-15' },
      { id: 'v2', projeto: 'PL 5678/2023 - Marco Temporal', voto: 'Sim', data: '2023-09-20' },
    ],
    despesas: [
      { id: 'd1', valor: 12000.00, data: '2024-02-10', tipo: 'Divulgação' },
    ],
    noticias: []
  },
  {
    id: '6',
    nome: 'Sérgio Moro',
    partido: 'UNIÃO',
    estado: 'PR',
    cargo: 'Senador',
    foto: 'https://picsum.photos/seed/moro/400/400',
    notaMedia: 3.2,
    presenca: 90,
    alinhamentoGoverno: 40,
    votacoes: [
      { id: 'v1', projeto: 'PEC 45/2019 - Reforma Tributária', voto: 'Sim', data: '2023-11-08' },
    ],
    despesas: [
      { id: 'd1', valor: 15000.00, data: '2024-02-10', tipo: 'Segurança' },
    ],
    noticias: []
  }
];
