import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  Star, 
  ChevronLeft, 
  Calendar, 
  FileText, 
  DollarSign, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  MinusCircle,
  ExternalLink,
  BarChart3
} from 'lucide-react';
import { mockPoliticos } from '../data/mockData';
import { cn } from '../lib/utils';
import { EvaluationModal } from '../components/EvaluationModal';

export const PoliticoProfile = () => {
  const { id } = useParams();
  const politico = mockPoliticos.find(p => p.id === id);
  const [activeTab, setActiveTab] = useState('geral');
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!politico) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold text-slate-900">Político não encontrado</h2>
        <Link to="/" className="text-blue-600 hover:underline">Voltar para o início</Link>
      </div>
    );
  }

  const tabs = [
    { id: 'geral', label: 'Visão Geral', icon: BarChart3 },
    { id: 'votacoes', label: 'Votações', icon: CheckCircle2 },
    { id: 'despesas', label: 'Despesas', icon: DollarSign },
    { id: 'noticias', label: 'Notícias', icon: FileText },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/" className="mb-8 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors">
        <ChevronLeft size={16} />
        Voltar para a busca
      </Link>

      {/* Header Section */}
      <div className="relative mb-12 overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-2xl border-4 border-slate-50 shadow-md">
            <img 
              src={politico.foto} 
              alt={politico.nome} 
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-900">{politico.nome}</h1>
                <p className="text-lg font-medium text-slate-500">
                  {politico.partido} • {politico.estado} • {politico.cargo}
                </p>
              </div>
              <div className="flex flex-col items-center md:items-end gap-1">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star 
                      key={s} 
                      size={20} 
                      className={s <= Math.round(politico.notaMedia) ? "fill-yellow-400 text-yellow-400" : "text-slate-200"} 
                    />
                  ))}
                </div>
                <span className="text-2xl font-black text-slate-900">{politico.notaMedia.toFixed(1)}</span>
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Nota Média</span>
              </div>
            </div>
            
            <div className="mt-8 flex flex-wrap justify-center md:justify-start gap-4">
              <button 
                onClick={() => setIsModalOpen(true)}
                className="rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
              >
                Avalie este político
              </button>
              <button className="rounded-2xl bg-slate-100 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-all">
                Seguir atualizações
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="mb-8 flex border-b border-slate-200 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-bold transition-all whitespace-nowrap",
              activeTab === tab.id 
                ? "border-blue-600 text-blue-600" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'geral' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-8">
              <h3 className="text-lg font-bold text-slate-900 mb-6">Desempenho Parlamentar</h3>
              <div className="space-y-8">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600">Presença em Sessões</span>
                    <span className="text-sm font-bold text-slate-900">{politico.presenca}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${politico.presenca}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600">Alinhamento com o Governo</span>
                    <span className="text-sm font-bold text-slate-900">{politico.alinhamentoGoverno}%</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${politico.alinhamentoGoverno}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-10 p-4 rounded-2xl bg-blue-50 border border-blue-100 flex gap-3">
                <Info size={20} className="text-blue-600 shrink-0" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  O alinhamento é calculado com base na convergência dos votos do parlamentar com a orientação da liderança do governo no Congresso.
                </p>
              </div>
            </div>
            
            <div className="rounded-3xl border border-slate-200 bg-white p-8 flex flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-50 text-yellow-600">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Histórico de Escândalos</h3>
              <p className="mt-2 text-sm text-slate-500 max-w-xs">
                Nenhum processo judicial ou escândalo grave registrado recentemente para este parlamentar em fontes oficiais.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'votacoes' && (
          <div className="space-y-4">
            {politico.votacoes.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-slate-300">
                <div className="flex gap-4 items-start">
                  <div className={cn(
                    "mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    v.voto === 'Sim' ? "bg-emerald-50 text-emerald-600" : 
                    v.voto === 'Não' ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"
                  )}>
                    {v.voto === 'Sim' ? <CheckCircle2 size={20} /> : 
                     v.voto === 'Não' ? <XCircle size={20} /> : <MinusCircle size={20} />}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">{v.projeto}</h4>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(v.data).toLocaleDateString('pt-BR')}</span>
                      <span className={cn(
                        "font-bold uppercase tracking-wider",
                        v.voto === 'Sim' ? "text-emerald-600" : 
                        v.voto === 'Não' ? "text-rose-600" : "text-slate-600"
                      )}>Votou: {v.voto}</span>
                    </div>
                  </div>
                </div>
                <button className="text-slate-400 hover:text-blue-600">
                  <ExternalLink size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'despesas' && (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo de Despesa</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {politico.despesas.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-slate-600">{new Date(d.data).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{d.tipo}</td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(d.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="px-6 py-4 text-sm text-slate-900">Total no período</td>
                  <td className="px-6 py-4 text-sm text-slate-900 text-right">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                      politico.despesas.reduce((acc, curr) => acc + curr.valor, 0)
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {activeTab === 'noticias' && (
          <div className="space-y-6">
            {politico.noticias.map((n) => (
              <a 
                key={n.id} 
                href={n.link}
                className="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-blue-200 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">Notícia</span>
                  <span className="text-xs text-slate-400">{new Date(n.data).toLocaleDateString('pt-BR')}</span>
                </div>
                <h4 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{n.titulo}</h4>
                <div className="mt-2 flex items-center gap-1 text-sm font-medium text-slate-500">
                  Ler matéria completa <ChevronRight size={14} />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <EvaluationModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        politicoName={politico.nome} 
      />
    </div>
  );
};

const Info = ({ size, className }: { size: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
  </svg>
);
