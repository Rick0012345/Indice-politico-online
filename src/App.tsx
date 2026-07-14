import React, {Suspense, lazy} from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar, Footer } from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';

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
const Admin = lazy(() => import('./pages/Admin').then((module) => ({default: module.Admin})));
const Methodology = lazy(() =>
  import('./pages/Methodology').then((module) => ({default: module.Methodology})),
);
const About = lazy(() => import('./pages/About').then((module) => ({default: module.About})));

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900 dark:bg-slate-950 dark:text-slate-50 dark:selection:bg-blue-900 dark:selection:text-blue-100">
          <Navbar />
          <main>
            <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-16 text-center text-slate-500">Carregando...</div>}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/politico/:id" element={<PoliticoProfile />} />
                <Route path="/ranking" element={<Ranking />} />
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
    </ThemeProvider>
  );
}
