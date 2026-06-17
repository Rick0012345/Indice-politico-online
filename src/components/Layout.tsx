import React, {useEffect, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {Menu, Moon, Sun, X} from 'lucide-react';
import {useTheme} from '../context/ThemeContext';

const navItems = [
  {to: '/', label: 'Início'},
  {to: '/ranking', label: 'Ranking'},
  {to: '/partidos', label: 'Partidos'},
  {to: '/camara', label: 'Câmara'},
  {to: '/admin', label: 'Admin'},
  {to: '/sobre', label: 'Sobre'},
  {to: '/metodologia', label: 'Metodologia'},
];

export const Navbar = () => {
  const {pathname} = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const {theme, toggleTheme} = useTheme();

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const getNavLinkClasses = (to: string, isMobile = false) => {
    const isActive = pathname === to;

    if (isMobile) {
      return [
        'rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
        isActive
          ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900'
          : 'text-slate-600 hover:bg-slate-50 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400',
      ].join(' ');
    }

    return [
      'transition-colors hover:text-blue-600 dark:hover:text-blue-400',
      isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400',
    ].join(' ');
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/85 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex items-center gap-2">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
              CP
            </div>
            <span className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-xl dark:text-slate-50">
              Catálogo<span className="text-blue-600">Político</span>
            </span>
          </Link>
        </div>

        <div className="hidden items-center gap-8 text-sm font-medium md:flex">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={getNavLinkClasses(item.to)}>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            className="rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            type="button"
            className="rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 md:hidden dark:text-slate-400 dark:hover:bg-slate-800"
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setIsMobileMenuOpen((current) => !current)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="border-t border-slate-200 bg-white/95 px-4 py-4 shadow-sm md:hidden dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex flex-col gap-2">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} className={getNavLinkClasses(item.to, true)}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export const Footer = () => {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-12 dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white">
                CP
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Catálogo Político
              </span>
            </div>
            <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Dados abertos da Câmara organizados para comparação, acompanhamento e participação cidadã.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-50">
              Links úteis
            </h4>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <Link to="/ranking" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Ranking geral
                </Link>
              </li>
              <li>
                <Link to="/metodologia" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Metodologia
                </Link>
              </li>
              <li>
                <Link to="/sobre" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Sobre o projeto
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900 dark:text-slate-50">
              Dados
            </h4>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <Link to="/camara" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Câmara
                </Link>
              </li>
              <li>
                <Link to="/partidos" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Partidos
                </Link>
              </li>
              <li>
                <Link to="/admin" className="hover:text-blue-600 dark:hover:text-blue-400">
                  Ingestão
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-slate-200 pt-8 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
          © 2024 Catálogo Político. Dados extraídos de fontes oficiais.
        </div>
      </div>
    </footer>
  );
};
