import React, { useState } from 'react';
import { Search, Star, TrendingUp, TrendingDown, Filter, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mockPoliticos } from '../data/mockData';
import { cn } from '../lib/utils';

const PoliticoCard = ({ politico, type }: { politico: any, type: 'best' | 'worst' }) => {
  return (
    <Link 
      to={`/politico/${politico.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:shadow-lg hover:-translate-y-1"
    >
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-slate-100">
          <img 
            src={politico.foto} 
            alt={politico.nome} 
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{politico.nome}</h3>
          <p className="text-xs text-slate-500">{politico.partido} • {politico.estado}</p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700">{politico.notaMedia.toFixed(1)}</span>
          </div>
        </div>
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          type === 'best' ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
        )}>
          {type === 'best' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        </div>
      </div>
    </Link>
  );
};

export const Home = () => {
  const [search, setSearch] = useState('');

  // Simulating 4 best and 4 worst (using mock data)
  const bestPoliticos = [...mockPoliticos].sort((a, b) => b.notaMedia - a.notaMedia).slice(0, 4);
  const worstPoliticos = [...mockPoliticos].sort((a, b) => a.notaMedia - b.notaMedia).slice(0, 4);

  return (
    <div className="flex flex-col gap-16 pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-slate-50 py-24 sm:py-32">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.blue.100),theme(colors.white))] opacity-20" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Transparência que gera <span className="text-blue-600">mudança</span>.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-600 max-w-2xl mx-auto">
            Acompanhe votos, gastos e o desempenho dos seus representantes. 
            O poder da informação em suas mãos.
          </p>
          
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="relative w-full max-w-2xl">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                className="block w-full rounded-2xl border-0 py-4 pl-12 pr-4 text-slate-900 shadow-xl ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                placeholder="Busque um político por nome, cargo ou estado..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            <div className="flex flex-wrap justify-center gap-2">
              <span className="text-sm font-medium text-slate-500 py-2">Filtros rápidos:</span>
              {['Deputado Federal', 'Senador', 'SP', 'RJ', 'MG', 'AL'].map((filter) => (
                <button 
                  key={filter}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Destaques Section */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Melhores Avaliados */}
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-600" />
                <h2 className="text-2xl font-bold text-slate-900">Mais bem avaliados</h2>
              </div>
              <Link to="#" className="text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1">
                Ver ranking completo <ChevronRight size={16} />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {bestPoliticos.map(p => (
                <PoliticoCard key={p.id} politico={p} type="best" />
              ))}
            </div>
          </div>

          {/* Piores Avaliados */}
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="text-rose-600" />
                <h2 className="text-2xl font-bold text-slate-900">Piores da semana</h2>
              </div>
              <Link to="#" className="text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1">
                Ver todos <ChevronRight size={16} />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {worstPoliticos.map(p => (
                <PoliticoCard key={p.id} politico={p} type="worst" />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
