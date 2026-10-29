import React from 'react';
import { ShieldCheck, Database, Users, Star, CheckCircle2, Info } from 'lucide-react';

export const Methodology = () => {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">Nossa Metodologia</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Transparência não é apenas sobre dados, é sobre como eles são processados e apresentados.
        </p>
      </div>

      <div className="space-y-16">
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400">
              <Database size={20} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Fontes de Dados</h2>
          </div>
          <p className="text-slate-600 leading-relaxed dark:text-slate-400">
            A fonte implementada para os registros parlamentares é a API de Dados Abertos da <strong>Câmara dos Deputados</strong>.
            A atualização depende da execução da importação e da disponibilidade da fonte. Os dados exibidos refletem o conteúdo importado, sem garantia de atualização diária.
          </p>
        </section>

        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-400">
              <Star size={20} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Sistema de Avaliação</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-slate-200 p-6 bg-white dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-bold text-slate-900 mb-2 dark:text-slate-50">Voto Popular (1-5 Estrelas)</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                A nota principal exibida no perfil é a média das avaliações registradas. O CPF digitado é convertido em hash para limitar duplicatas por político; uma nova avaliação com o mesmo CPF substitui a anterior. Esse mecanismo não autentica a identidade da pessoa e não utiliza login Gov.br.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-6 bg-white dark:border-slate-700 dark:bg-slate-900">
              <h3 className="font-bold text-slate-900 mb-2 dark:text-slate-50">Ponderação de Atividade</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Embora a nota seja popular, exibimos métricas objetivas como presença em sessões e alinhamento partidário para fornecer contexto à avaliação do cidadão.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-slate-900 p-8 text-white dark:bg-slate-100 dark:text-slate-900">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="text-blue-400 dark:text-blue-600" size={24} />
            <h2 className="text-2xl font-bold">Integridade e Segurança</h2>
          </div>
          <ul className="space-y-4">
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0 dark:text-blue-600" size={20} />
              <p className="text-slate-300 text-sm dark:text-slate-700"><strong>Limite de identidade:</strong> Informar um CPF válido não comprova que ele pertence à pessoa que avalia.</p>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0 dark:text-blue-600" size={20} />
              <p className="text-slate-300 text-sm dark:text-slate-700"><strong>Tratamento do CPF:</strong> O CPF digitado é convertido em hash e não é exibido publicamente. O hash permite reconhecer avaliações repetidas para o mesmo político.</p>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="text-blue-400 shrink-0 dark:text-blue-600" size={20} />
              <p className="text-slate-300 text-sm dark:text-slate-700"><strong>Auditoria:</strong> Nosso código de processamento de dados é aberto para auditoria de especialistas em tecnologia cívica.</p>
            </li>
          </ul>
        </section>

        <div className="flex items-center gap-3 p-6 rounded-2xl bg-blue-50 border border-blue-100 dark:bg-blue-950 dark:border-blue-900">
          <Info className="text-blue-600 shrink-0 dark:text-blue-400" size={24} />
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Tem alguma dúvida sobre como os dados são calculados? Entre em contato com nossa equipe técnica através do canal de transparência.
          </p>
        </div>
      </div>
    </div>
  );
};
