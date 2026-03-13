import React from 'react';
import { Link } from 'react-router-dom';
import { Search, Menu, User } from 'lucide-react';

export const Navbar = () => {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white font-bold">
              VC
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Voto<span className="text-blue-600">Consciente</span>
            </span>
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
          <Link to="/" className="hover:text-blue-600 transition-colors">Início</Link>
          <Link to="/ranking" className="hover:text-blue-600 transition-colors">Ranking</Link>
          <Link to="/sobre" className="hover:text-blue-600 transition-colors">Sobre</Link>
          <Link to="/metodologia" className="hover:text-blue-600 transition-colors">Metodologia</Link>
        </div>

        <div className="flex items-center gap-4">
          <button className="hidden sm:flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
            <User size={18} />
            <span>Entrar</span>
          </button>
          <button className="md:hidden text-slate-600">
            <Menu size={24} />
          </button>
        </div>
      </div>
    </nav>
  );
};

export const Footer = () => {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-white font-bold text-xs">
                VC
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                Catálogo Político
              </span>
            </div>
            <p className="text-sm text-slate-500 max-w-xs">
              Promovendo a transparência e a participação cidadã através de dados abertos e tecnologia cívica.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Links Úteis</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/ranking" className="hover:text-blue-600">Ranking Geral</Link></li>
              <li><Link to="/metodologia" className="hover:text-blue-600">Metodologia</Link></li>
              <li><Link to="/sobre" className="hover:text-blue-600">Sobre o Projeto</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Contato</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="#" className="hover:text-blue-600">Fale Conosco</Link></li>
              <li><Link to="#" className="hover:text-blue-600">Imprensa</Link></li>
              <li><Link to="#" className="hover:text-blue-600">Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-200 text-center text-xs text-slate-400">
          © 2024 Catálogo Político. Dados extraídos de fontes oficiais.
        </div>
      </div>
    </footer>
  );
};
