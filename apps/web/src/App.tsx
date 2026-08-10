import { Route, Routes } from "react-router-dom";
import { Header } from "./components/layout/Header";
import { Footer } from "./components/layout/Footer";
import { Home } from "./pages/Home";
import { CandidatoPerfil } from "./pages/CandidatoPerfil";
import { PainelPesos } from "./pages/PainelPesos";
import { Comparador } from "./pages/Comparador";
import { Metodologia } from "./pages/Metodologia";
import { NotFound } from "./pages/NotFound";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/candidatos/:id" element={<CandidatoPerfil />} />
          <Route path="/comparar" element={<Comparador />} />
          <Route path="/pesos" element={<PainelPesos />} />
          <Route path="/metodologia" element={<Metodologia />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
