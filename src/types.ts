export interface Votacao {
  id: string;
  projeto: string;
  voto: 'Sim' | 'Não' | 'Abstenção';
  data: string;
}

export interface Despesa {
  id: string;
  valor: number;
  data: string;
  tipo: string;
}

export interface Noticia {
  id: string;
  titulo: string;
  link: string;
  data: string;
}

export interface Politico {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  cargo: string;
  foto: string;
  notaMedia: number;
  presenca: number;
  alinhamentoGoverno: number;
  votacoes: Votacao[];
  despesas: Despesa[];
  noticias: Noticia[];
}
