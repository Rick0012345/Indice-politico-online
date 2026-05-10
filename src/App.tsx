import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar, Footer } from './components/Layout';
import { Home } from './pages/Home';
import { PoliticoProfile } from './pages/PoliticoProfile';
import { Ranking } from './pages/Ranking';
import { Partidos } from './pages/Partidos';
import { Camara } from './pages/Camara';
import { ProposicaoDetail } from './pages/ProposicaoDetail';
import { Methodology } from './pages/Methodology';
import { About } from './pages/About';
import { Admin } from './pages/Admin';
import { ThemeProvider } from './context/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900 dark:bg-slate-950 dark:text-slate-50 dark:selection:bg-blue-900 dark:selection:text-blue-100">
          <Navbar />
          <main>
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
          </main>
          <Footer />
        </div>
      </Router>
    </ThemeProvider>
  );
}
