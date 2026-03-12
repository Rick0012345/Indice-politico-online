import React, { useState } from 'react';
import { Star, Filter, Search, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mockPoliticos } from '../data/mockData';
import { cn } from '../lib/utils';

export const Ranking = () => {
  const [filter, setFilter] = useState<'all' | 'best' | 'worst'>('all');
  const [cargo, setCargo] = useState('Todos');

  const sortedPoliticos = [...mockPoliticos].sort((a, b) => {
    if (filter === 'best') return b.notaMedia - a.notaMedia;
    if (filter === 'worst') return a.notaMedia - b.notaMedia;
    return b.notaMedia - a.notaMedia; // Default to best
  });

  const filteredPoliticos = sortedPoliticos.filter(p => {
    if (cargo === 'Todos') return true;
    return p.cargo === cargo;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold text-slate-900">Ranking de Transparência</h1>
        <p className="mt-4 text-lg text-slate-600">
          Veja quem são os políticos mais bem avaliados pela população brasileira.
        </p>
      </div>

      <div className="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex p-1 bg-slate-100 rounded-2xl w-full md:w-auto">
          <button 
            onClick={() => setFilter('best')}
            className={cn(
              "flex-1 md:flex-none px-6 py-2 rounded-xl text-sm font-bold transition-all",
              filter === 'best' || filter === 'all' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            Melhores
          </button>
          <button 
            onClick={() => setFilter('worst')}
            className={cn(
              "flex-1 md:flex-none px-6 py-2 rounded-xl text-sm font-bold transition-all",
              filter === 'worst' ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            Piores
          </button>
        </div>

        <div className="flex gap-4 w-full md:w-auto">
          <select 
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            className="flex-1 md:flex-none rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600"
          >
            <option>Todos os Cargos</option>
            <option>Deputado Federal</option>
            <option>Senador</option>
          </select>
          <button className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Filter size={18} />
            Filtrar
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-20">Posição</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Político</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Partido/UF</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cargo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Nota</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPoliticos.map((p, index) => (
                <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-6">
                    <span className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-sm font-black",
                      index === 0 ? "bg-yellow-100 text-yellow-700" :
                      index === 1 ? "bg-slate-100 text-slate-700" :
                      index === 2 ? "bg-orange-100 text-orange-700" : "text-slate-400"
                    )}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-3">
                      <img 
                        src={p.foto} 
                        alt={p.nome} 
                        className="h-10 w-10 rounded-full object-cover border border-slate-100"
                        referrerPolicy="no-referrer"
                      />
                      <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{p.nome}</span>
                    </div>
                  </td>
                  <td className="px-6 py-6 text-sm text-slate-600">
                    {p.partido} / {p.estado}
                  </td>
                  <td className="px-6 py-6 text-sm text-slate-600">
                    {p.cargo}
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center justify-center gap-1">
                      <Star size={14} className="fill-yellow-400 text-yellow-400" />
                      <span className="font-bold text-slate-900">{p.notaMedia.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <Link 
                      to={`/politico/${p.id}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
                    >
                      Ver Perfil <ChevronRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
