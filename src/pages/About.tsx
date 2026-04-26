import React from 'react';
import { Heart, Globe, Shield, Zap, Users, MessageSquare } from 'lucide-react';

export const About = () => {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">Sobre o Catálogo Político</h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto dark:text-slate-400">
          Nascemos da necessidade de aproximar o cidadão da realidade política brasileira através de dados claros e acessíveis.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-20">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-6 dark:text-slate-50">Nossa Missão</h2>
          <p className="text-slate-600 leading-relaxed mb-4 dark:text-slate-400">
            O Catálogo Político é uma iniciativa independente de tecnologia cívica que visa democratizar o acesso à informação parlamentar. Acreditamos que um cidadão bem informado é a base de uma democracia forte.
          </p>
          <p className="text-slate-600 leading-relaxed dark:text-slate-400">
            Nossa plataforma transforma dados complexos do governo em uma interface amigável, permitindo que qualquer pessoa, independente do seu conhecimento técnico, possa fiscalizar seus representantes.
          </p>
        </div>
        <div className="relative rounded-3xl overflow-hidden shadow-2xl">
          <img
            src="https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&q=80&w=1000"
            alt="Congresso Nacional"
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
        {[
          { icon: Globe, title: "Independente", desc: "Não possuímos vínculo com partidos ou órgãos governamentais." },
          { icon: Shield, title: "Seguro", desc: "Utilizamos autenticação oficial para garantir a veracidade das avaliações." },
          { icon: Zap, title: "Em Tempo Real", desc: "Dados atualizados diariamente via APIs oficiais do governo." },
          { icon: Users, title: "Colaborativo", desc: "Feito por cidadãos para cidadãos, focado na experiência do usuário." },
          { icon: MessageSquare, title: "Transparente", desc: "Metodologia aberta e clara sobre a origem de cada informação." },
          { icon: Heart, title: "Cívico", desc: "Nosso objetivo é fortalecer a cultura de fiscalização no Brasil." },
        ].map((item, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 p-6 bg-white hover:border-blue-200 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <item.icon size={20} />
            </div>
            <h3 className="font-bold text-slate-900 mb-2 dark:text-slate-50">{item.title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed dark:text-slate-400">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-blue-600 p-10 text-center text-white">
        <h2 className="text-2xl font-bold mb-4">Quer contribuir com o projeto?</h2>
        <p className="text-blue-100 mb-8 max-w-xl mx-auto">
          Somos um projeto de código aberto e aceitamos contribuições de desenvolvedores, designers e especialistas em dados.
        </p>
        <button className="rounded-2xl bg-white px-8 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 transition-all">
          Ver no GitHub
        </button>
      </div>
    </div>
  );
};
