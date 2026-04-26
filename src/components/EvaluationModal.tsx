import React, {useEffect, useState} from 'react';
import {Star, X, ShieldCheck, Info} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';

type EvaluationSavedPayload = {
  action: 'created' | 'updated';
  notaMedia: number;
  totalAvaliacoes: number;
};

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  politicoId: string;
  politicoName: string;
  onEvaluationSaved?: (payload: EvaluationSavedPayload) => void;
}

const formatCpf = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);

  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
};

export const EvaluationModal = ({
  isOpen,
  onClose,
  politicoId,
  politicoName,
  onEvaluationSaved,
}: EvaluationModalProps) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [cpf, setCpf] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const cpfDigits = cpf.replace(/\D/g, '');

  useEffect(() => {
    if (!isOpen) return;

    setRating(0);
    setHoveredRating(0);
    setCpf('');
    setComment('');
    setIsSubmitting(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [isOpen]);

  const handleConfirm = async () => {
    if (rating === 0) {
      setErrorMessage('Escolha uma nota entre 1 e 5 estrelas.');
      return;
    }

    if (cpfDigits.length !== 11) {
      setErrorMessage('Informe um CPF valido para registrar a avaliacao.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}/avaliacoes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cpf: cpfDigits,
          nota: rating,
          comentario: comment.trim() || null,
        }),
      });

      const data = (await response.json()) as {
        action?: 'created' | 'updated';
        comentario?: string | null;
        error?: string;
        message?: string;
        notaMedia?: number;
        totalAvaliacoes?: number;
      };

      if (!response.ok) {
        setErrorMessage(data.error ?? 'Nao foi possivel registrar sua avaliacao agora.');
        return;
      }

      const payload: EvaluationSavedPayload = {
        action: data.action === 'updated' ? 'updated' : 'created',
        notaMedia: typeof data.notaMedia === 'number' ? data.notaMedia : rating,
        totalAvaliacoes: typeof data.totalAvaliacoes === 'number' ? data.totalAvaliacoes : 0,
      };

      onEvaluationSaved?.(payload);
      setSuccessMessage(
        data.message ??
          (payload.action === 'updated'
            ? 'Sua avaliacao foi atualizada com sucesso.'
            : 'Sua avaliacao foi registrada com sucesso.'),
      );

      window.setTimeout(() => {
        onClose();
      }, 1000);
    } catch {
      setErrorMessage('Falha de conexao. Tente novamente em instantes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{opacity: 0, scale: 0.95, y: 20}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.95, y: 20}}
            className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl dark:bg-slate-900"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <X size={24} />
            </button>

            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                <Star size={24} className="fill-blue-600 dark:fill-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Avaliar Politico</h2>
              <p className="mt-2 text-slate-500 dark:text-slate-400">
                Como voce avalia a atuacao de{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-50">{politicoName}</span>?
              </p>
            </div>

            <div className="my-8 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => {
                    setRating(star);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    size={40}
                    className={
                      (hoveredRating || rating) >= star
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-slate-200 dark:text-slate-700'
                    }
                  />
                </button>
              ))}
            </div>

            <div className="mb-6">
              <label htmlFor="comentario" className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Comentario (opcional)
              </label>
              <textarea
                id="comentario"
                rows={4}
                maxLength={500}
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="mt-2 block w-full resize-none rounded-2xl border-0 px-4 py-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                placeholder="Conte em poucas palavras o motivo da sua nota."
              />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Seu comentario sera salvo junto com a avaliacao.</span>
                <span>{comment.length}/500</span>
              </div>
            </div>

            <div className="mb-6">
              <label htmlFor="cpf" className="text-sm font-bold text-slate-700 dark:text-slate-300">
                CPF para validar o voto
              </label>
              <input
                id="cpf"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                value={cpf}
                onChange={(event) => {
                  setCpf(formatCpf(event.target.value));
                  if (errorMessage) setErrorMessage(null);
                }}
                className="mt-2 block w-full rounded-2xl border-0 px-4 py-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                placeholder="000.000.000-00"
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                O CPF e processado em hash para impedir votos duplicados no mesmo politico.
              </p>
            </div>

            <div className="mb-6 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
              <div className="flex gap-3">
                <ShieldCheck className="shrink-0 text-blue-600 dark:text-blue-400" size={20} />
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-50">Validacao unica por CPF</h4>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Se este CPF ja avaliou este politico, a nota anterior sera substituida pela nova.
                  </p>
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {errorMessage}
              </div>
            )}

            {successMessage && (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {successMessage}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                disabled={rating === 0 || cpfDigits.length !== 11 || isSubmitting}
                onClick={handleConfirm}
                className="w-full rounded-2xl bg-blue-600 py-4 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
              >
                {isSubmitting ? 'Salvando avaliacao...' : 'Confirmar voto'}
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Cancelar
              </button>
            </div>

            <div className="mt-6 flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              <Info size={12} />
              Seus dados estao protegidos pela LGPD
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
