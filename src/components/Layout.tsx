import React, {useEffect, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {ExternalLink, Menu, Moon, Search, Sun, X} from 'lucide-react';
import {useTheme} from '../context/ThemeContext';
import {CommandPalette} from './CommandPalette';
import {cn} from '../lib/utils';

const navItems = [
  {to: '/', label: 'Início', group: 'primary'},
  {to: '/ranking', label: 'Ranking', group: 'primary'},
  {to: '/comparar', label: 'Comparar', group: 'primary'},
  {to: '/partidos', label: 'Partidos', group: 'primary'},
  {to: '/camara', label: 'Câmara', group: 'primary'},
  {to: '/metodologia', label: 'Metodologia', group: 'secondary'},
  {to: '/sobre', label: 'Sobre', group: 'secondary'},
  {to: '/admin', label: 'Admin', group: 'secondary'},
] as const;

const isRouteActive = (pathname: string, to: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

export const BrandMark: React.FC<{size?: 'sm' | 'md'}> = ({size = 'md'}) => (
  <span
    aria-hidden="true"
    className={cn(
      'relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 font-mono font-semibold text-white dark:bg-white dark:text-slate-900',
      size === 'md' ? 'h-8 w-8 text-[13px]' : 'h-6 w-6 text-[10px]',
    )}
  >
    CP
    <span className="absolute bottom-0 left-0 h-[3px] w-full bg-brand-500" />
  </span>
);

export const Navbar = () => {
  const {pathname} = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const {theme, toggleTheme} = useTheme();

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsPaletteOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsPaletteOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const getNavLinkClasses = (to: string, isMobile = false, secondary = false) => {
    const isActive = isRouteActive(pathname, to);

    if (isMobile) {
      return cn(
        'rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
        isActive
          ? 'bg-brand-50 text-blue-700 dark:bg-brand-950 dark:text-blue-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50',
      );
    }

    return cn(
      'relative rounded-lg px-3 py-2 transition-colors',
      secondary ? 'text-[13px]' : 'text-sm',
      isActive
        ? 'bg-slate-100 font-semibold text-blue-600 dark:bg-slate-800 dark:text-blue-400'
        : secondary
          ? 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50'
          : 'font-medium text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-50',
    );
  };

  const isRanking = pathname === '/ranking';

  return (
    <>
      <nav className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 dark:border-slate-800 dark:bg-slate-950/80">
        <div
          className={cn(
            'mx-auto flex h-16 items-center gap-4 px-4 sm:px-6 lg:px-8',
            isRanking ? 'w-full xl:px-10' : 'max-w-7xl',
          )}
        >
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none">
            <BrandMark />
            <span className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg dark:text-slate-50">
              Catálogo<span className="text-brand-600 dark:text-brand-400">Político</span>
            </span>
          </Link>

          <div className="hidden flex-1 items-center gap-1 lg:flex">
            <span className="mx-2 h-5 w-px bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
            {navItems
              .filter((item) => item.group === 'primary')
              .map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isRouteActive(pathname, item.to) ? 'page' : undefined}
                  className={getNavLinkClasses(item.to)}
                >
                  {item.label}
                </Link>
              ))}
            <div className="ml-auto hidden items-center gap-0.5 xl:flex">
              {navItems
                .filter((item) => item.group === 'secondary')
                .map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={isRouteActive(pathname, item.to) ? 'page' : undefined}
                    className={getNavLinkClasses(item.to, false, true)}
                  >
                    {item.label}
                  </Link>
                ))}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              aria-label="Abrir busca rápida"
              aria-keyshortcuts="Control+K"
              className="group flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 pl-2.5 pr-1.5 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200"
            >
              <Search size={15} />
              <span className="hidden pr-6 sm:inline">Buscar</span>
              <span className="hidden sm:inline-flex"><span className="kbd">Ctrl K</span></span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
              onClick={() => setIsMobileMenuOpen((current) => !current)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white/95 px-4 py-4 shadow-sm lg:hidden dark:border-slate-800 dark:bg-slate-950/95">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {navItems.map((item) => (
                <Link key={item.to} to={item.to} className={getNavLinkClasses(item.to, true)}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>
      <CommandPalette open={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
    </>
  );
};

const footerColumns = [
  {
    title: 'Explorar',
    links: [
      {to: '/ranking', label: 'Ranking geral'},
      {to: '/comparar', label: 'Comparador'},
      {to: '/partidos', label: 'Partidos'},
      {to: '/camara', label: 'Câmara'},
    ],
  },
  {
    title: 'Projeto',
    links: [
      {to: '/metodologia', label: 'Metodologia'},
      {to: '/sobre', label: 'Sobre o projeto'},
      {to: '/admin', label: 'Ingestão'},
    ],
  },
];

export const Footer = () => {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <BrandMark size="sm" />
              <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Catálogo Político
              </span>
            </div>
            <p className="max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-400">
              Dados abertos da Câmara organizados para comparação, acompanhamento e participação cidadã.
            </p>
            <a
              href="https://dadosabertos.camara.leg.br/"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Fonte: Dados Abertos da Câmara <ExternalLink size={13} />
            </a>
          </div>
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h4 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-50">{column.title}</h4>
              <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className="hover:text-slate-900 dark:hover:text-slate-50">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:text-slate-400">
          <span>© {new Date().getFullYear()} Catálogo Político. Dados extraídos de fontes oficiais.</span>
          <span className="flex items-center gap-1.5">
            Busca rápida <span className="kbd">Ctrl K</span>
          </span>
        </div>
      </div>
    </footer>
  );
};
