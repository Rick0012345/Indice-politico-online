import React, {Suspense, lazy} from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar, Footer } from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
import { CompareProvider } from './lib/compare';

const Home = lazy(() => import('./pages/Home').then((module) => ({default: module.Home})));
const PoliticoProfile = lazy(() =>
  import('./pages/PoliticoProfile').then((module) => ({default: module.PoliticoProfile})),
);
const Ranking = lazy(() => import('./pages/Ranking').then((module) => ({default: module.Ranking})));
const Partidos = lazy(() => import('./pages/Partidos').then((module) => ({default: module.Partidos})));
const Camara = lazy(() => import('./pages/Camara').then((module) => ({default: module.Camara})));
const ProposicaoDetail = lazy(() =>
  import('./pages/ProposicaoDetail').then((module) => ({default: module.ProposicaoDetail})),
);
const Comparador = lazy(() => import('./pages/Comparador').then((module) => ({default: module.Comparador})));
const Admin = lazy(() => import('./pages/Admin').then((module) => ({default: module.Admin})));
const Methodology = lazy(() =>
  import('./pages/Methodology').then((module) => ({default: module.Methodology})),
);
const About = lazy(() => import('./pages/About').then((module) => ({default: module.About})));

export default function App() {
  return (
    <ThemeProvider>
      <CompareProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900 dark:bg-slate-950 dark:text-slate-50 dark:selection:bg-blue-900 dark:selection:text-blue-100">
          <Navbar />
          <main>
            <Suspense fallback={<div className="mx-auto max-w-7xl space-y-4 px-4 py-16 sm:px-6 lg:px-8" aria-busy="true"><span className="sr-only">Carregando...</span><div className="skeleton h-10 w-2/3 max-w-xl" /><div className="skeleton h-4 w-1/2 max-w-md" /><div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-3"><div className="skeleton h-40" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div></div>}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/politico/:id" element={<PoliticoProfile />} />
                <Route path="/ranking" element={<Ranking />} />
                <Route path="/comparar" element={<Comparador />} />
                <Route path="/partidos" element={<Partidos />} />
                <Route path="/camara" element={<Camara />} />
                <Route path="/camara/proposicoes/:id" element={<ProposicaoDetail />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/metodologia" element={<Methodology />} />
                <Route path="/sobre" element={<About />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
      </Router>
      </CompareProvider>
    </ThemeProvider>
  );
}
