import React from 'react';
import { ShieldCheck, Database, Users, Star, CheckCircle2, Info } from 'lucide-react';

export const Methodology = () => {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-slate-900">Nossa Metodologia</h1>
        <p className="mt-4 text-lg text-slate-600">
          Transparência não é apenas sobre dados, é sobre como eles são processados e apresentados.
        </p>
      </div>

      <div className="space-y-16">
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <Database size={20} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Fontes de Dados</h2>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Todos os dados brutos apresentados no Catálogo Político são extraídos diretamente das APIs oficiais do Governo Federal, especificamente do <strong>Portal da Transparência</strong>, da <strong>Câmara dos Deputados</strong> e do <strong>Senado Federal</strong>. 
            Atualizamos nossa base de dados diariamente para garantir que você tenha acesso às informações mais recentes sobre votações e despesas.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <Star size={20} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Sistema de Avaliação</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-slate-200 p-6 bg-white">
              <h3 className="font-bold text-slate-900 mb-2">Voto Popular (1-5 Estrelas)</h3>
              <p className="text-sm text-slate-500">
                A nota principal exibida no perfil é a média das avaliações feitas pelos usuários autenticados. Utilizamos o sistema Gov.br para garantir que cada CPF possa votar apenas uma vez em cada político, evitando bots e manipulações.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-6 bg-white">
              <h3 className="font-bold text-slate-900 mb-2">Ponderação de Atividade</h3>
              <p className="text-sm text-slate-500">
                Embora a nota seja popular, exibimos métricas objetivas como presença em sessões e alinhamento partidário para fornecer contexto à avaliação do cidadão.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-slate-900 p-8 text-white">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="text-blue-400" size={24} />
            <h2 className="text-2xl font-bold">Integridade e Segurança</h2>
          </div>
          <ul className="space-y-4">
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0" size={20} />
              <p className="text-slate-300 text-sm"><strong>Autenticação Obrigatória:</strong> Nenhuma avaliação é aceita sem login via Gov.br.</p>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0" size={20} />
              <p className="text-slate-300 text-sm"><strong>Proteção de Dados:</strong> Seguimos rigorosamente a LGPD. O seu CPF é usado apenas para validação do voto e nunca é exibido ou compartilhado.</p>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0" size={20} />
              <p className="text-slate-300 text-sm"><strong>Auditoria:</strong> Nosso código de processamento de dados é aberto para auditoria de especialistas em tecnologia cívica.</p>
            </li>
          </ul>
        </section>

        <div className="flex items-center gap-3 p-6 rounded-2xl bg-blue-50 border border-blue-100">
          <Info className="text-blue-600 shrink-0" size={24} />
          <p className="text-sm text-blue-800">
            Tem alguma dúvida sobre como os dados são calculados? Entre em contato com nossa equipe técnica através do canal de transparência.
          </p>
        </div>
      </div>
    </div>
  );
};
