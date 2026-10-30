import React from 'react';
import {Link} from 'react-router-dom';

const valores = [
  {title: 'Independente', desc: 'Não possuímos vínculo com partidos ou órgãos governamentais.'},
  {title: 'Avaliações por CPF', desc: 'O CPF digitado é convertido em hash para limitar duplicatas; não há autenticação de identidade.'},
  {title: 'Dados importados', desc: 'Fonte implementada: Câmara dos Deputados. A atualização depende da execução da importação.'},
  {title: 'Colaborativo', desc: 'Feito por cidadãos para cidadãos, focado na experiência do usuário.'},
  {title: 'Transparente', desc: 'Metodologia aberta e clara sobre a origem de cada informação.'},
  {title: 'Cívico', desc: 'Nosso objetivo é fortalecer a cultura de fiscalização no Brasil.'},
];

export const About = () => {
  return (
    <div className="mx-auto max-w-7xl space-y-16 px-4 pb-24 pt-14 sm:px-6 lg:px-8">
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-slate-950 sm:text-5xl dark:text-slate-50">Sobre o Catálogo Político</h1>
          <p className="mt-5 text-lg leading-8 text-slate-700 dark:text-slate-300">
            Nascemos da necessidade de aproximar o cidadão da realidade política brasileira através de dados claros e acessíveis.
          </p>
          <h2 className="mt-10 text-xl font-semibold text-slate-900 dark:text-slate-50">Nossa missão</h2>
          <p className="mt-3 max-w-[60ch] leading-7 text-slate-600 dark:text-slate-400">
            O Catálogo Político é uma iniciativa independente de tecnologia cívica que visa democratizar o acesso à informação parlamentar. Acreditamos que um cidadão bem informado é a base de uma democracia forte.
          </p>
          <p className="mt-3 max-w-[60ch] leading-7 text-slate-600 dark:text-slate-400">
            Nossa plataforma transforma dados complexos do governo em uma interface amigável, permitindo que qualquer pessoa, independente do seu conhecimento técnico, possa fiscalizar seus representantes.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800">
          <img
            src="https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&q=80&w=1000"
            alt="Congresso Nacional"
            className="aspect-[4/3] h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </section>

      <section aria-label="Nossos princípios" className="grid grid-cols-1 gap-x-12 border-t border-slate-200 md:grid-cols-2 dark:border-slate-800">
        {valores.map((item, index) => (
          <div key={item.title} className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-6 dark:border-slate-800">
            <span className="tabular pt-0.5 font-mono text-sm text-brand-600 dark:text-brand-400">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{item.title}</h3>
              <p className="mt-1 leading-7 text-slate-600 dark:text-slate-400">{item.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-slate-900 p-8 text-white sm:p-10 md:flex-row md:items-center dark:bg-slate-800">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Quer contribuir com o projeto?</h2>
          <p className="mt-2 max-w-xl leading-7 text-slate-300">
            Somos um projeto de código aberto e aceitamos contribuições de desenvolvedores, designers e especialistas em dados.
          </p>
        </div>
        <Link to="/metodologia" className="shrink-0 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 active:scale-[0.98]">
          Ver a metodologia
        </Link>
      </section>
    </div>
  );
};
