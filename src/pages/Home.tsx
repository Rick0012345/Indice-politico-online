import React, { useEffect, useState } from 'react';
import { Search, Star, TrendingUp, TrendingDown, ChevronRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

type PoliticoCardModel = {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  foto: string;
  notaMedia: number;
};

const PoliticoCard: React.FC<{ politico: PoliticoCardModel; type: 'best' | 'worst' }> = ({ politico, type }) => {
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

const NovoPoliticoCard: React.FC<{ politico: PoliticoCardModel }> = ({ politico }) => {
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
          <h3 className="font-bold text-slate-900 transition-colors">{politico.nome}</h3>
          <p className="text-xs text-slate-500">{politico.partido} • {politico.estado}</p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700">{politico.notaMedia.toFixed(1)}</span>
          </div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Sparkles size={16} />
        </div>
      </div>
    </Link>
  );
};

export const Home = () => {
  const [search, setSearch] = useState('');
  const [novosCadastrados, setNovosCadastrados] = useState<PoliticoCardModel[]>([]);
  const [bestPoliticos, setBestPoliticos] = useState<PoliticoCardModel[]>([]);
  const [worstPoliticos, setWorstPoliticos] = useState<PoliticoCardModel[]>([]);
  const [searchResults, setSearchResults] = useState<PoliticoCardModel[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      try {
        const [bestRes, worstRes] = await Promise.all([
          fetch('/api/politicos/ranking?filter=best&limit=4', {signal: controller.signal}),
          fetch('/api/politicos/ranking?filter=worst&limit=4', {signal: controller.signal}),
        ]);

        if (bestRes.ok) {
          const data = (await bestRes.json()) as {items?: PoliticoCardModel[]};
          setBestPoliticos((data.items ?? []).map((p) => ({...p, foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400` })));
        }
        if (worstRes.ok) {
          const data = (await worstRes.json()) as {items?: PoliticoCardModel[]};
          setWorstPoliticos((data.items ?? []).map((p) => ({...p, foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400` })));
        }
      } catch {
      }
    };

    run();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      try {
        const response = await fetch('/api/politicos/novos?limit=6', {signal: controller.signal});
        if (!response.ok) return;
        const data = (await response.json()) as {items?: Array<Partial<PoliticoCardModel>>};

        const items = (data.items ?? [])
          .filter((p): p is Omit<PoliticoCardModel, 'foto'> & {foto?: string | null} => {
            return (
              typeof p.id === 'string' &&
              typeof p.nome === 'string' &&
              typeof p.partido === 'string' &&
              typeof p.estado === 'string' &&
              typeof p.notaMedia === 'number'
            );
          })
          .map((p) => ({
            id: p.id,
            nome: p.nome,
            partido: p.partido,
            estado: p.estado,
            notaMedia: p.notaMedia,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
          }));

        setNovosCadastrados(items);
      } catch {
      }
    };

    run();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const q = search.trim();
      if (q.length < 2) {
        setSearchResults([]);
        return;
      }

      try {
        const response = await fetch(`/api/politicos?search=${encodeURIComponent(q)}&limit=12`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {items?: PoliticoCardModel[]};
        setSearchResults(
          (data.items ?? []).map((p) => ({
            ...p,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
          })),
        );
      } catch {
      }
    };

    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [search]);

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

      {searchResults.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="text-slate-600" />
              <h2 className="text-2xl font-bold text-slate-900">Resultados</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {searchResults.map((p) => (
              <PoliticoCard key={p.id} politico={p} type="best" />
            ))}
          </div>
        </section>
      )}

      {novosCadastrados.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="text-blue-600" />
              <h2 className="text-2xl font-bold text-slate-900">Novos cadastrados</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {novosCadastrados.map((p) => (
              <NovoPoliticoCard key={p.id} politico={p} />
            ))}
          </div>
        </section>
      )}

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
