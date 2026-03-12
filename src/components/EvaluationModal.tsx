import React, { useState } from 'react';
import { Star, X, ShieldCheck, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  politicoName: string;
}

export const EvaluationModal = ({ isOpen, onClose, politicoName }: EvaluationModalProps) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = () => {
    if (rating === 0) return;
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      alert('Voto confirmado com sucesso! Sua avaliação foi processada via Gov.br.');
      onClose();
    }, 1500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl"
          >
            <button 
              onClick={onClose}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>

            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Star size={24} className="fill-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Avaliar Político</h2>
              <p className="mt-2 text-slate-500">
                Como você avalia a atuação de <span className="font-semibold text-slate-900">{politicoName}</span>?
              </p>
            </div>

            <div className="my-8 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    size={40}
                    className={
                      (hoveredRating || rating) >= star
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-slate-200"
                    }
                  />
                </button>
              ))}
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 mb-6">
              <div className="flex gap-3">
                <ShieldCheck className="text-blue-600 shrink-0" size={20} />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Autenticação Gov.br</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Para garantir a integridade do sistema, cada cidadão pode votar apenas uma vez por político usando seu CPF.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                disabled={rating === 0 || isSubmitting}
                onClick={handleConfirm}
                className="w-full rounded-2xl bg-blue-600 py-4 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all"
              >
                {isSubmitting ? "Processando..." : "Confirmar Voto"}
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Cancelar
              </button>
            </div>
            
            <div className="mt-6 flex items-center justify-center gap-1 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
              <Info size={12} />
              Seus dados estão protegidos pela LGPD
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
