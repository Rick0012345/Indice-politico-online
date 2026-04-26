import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar, Footer } from './components/Layout';
import { Home } from './pages/Home';
import { PoliticoProfile } from './pages/PoliticoProfile';
import { Ranking } from './pages/Ranking';
import { Methodology } from './pages/Methodology';
import { About } from './pages/About';
import { SalesDashboard } from './pages/SalesDashboard';
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
              <Route path="/vendas" element={<SalesDashboard />} />
              <Route path="/dashboard" element={<SalesDashboard />} />
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
