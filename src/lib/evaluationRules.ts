import {createHash} from 'node:crypto';

export const normalizeCpf = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\D/g, '').slice(0, 11);
};

export const calculateCpfCheckDigit = (baseDigits: string) => {
  let sum = 0;
  const startWeight = baseDigits.length + 1;

  for (let index = 0; index < baseDigits.length; index += 1) {
    sum += Number(baseDigits[index]) * (startWeight - index);
  }

  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

export const isValidCpf = (cpf: string) => {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const firstDigit = calculateCpfCheckDigit(cpf.slice(0, 9));
  const secondDigit = calculateCpfCheckDigit(cpf.slice(0, 10));

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
};

export const parseNota = (value: unknown) => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
};

export const parseComentario = (value: unknown) => {
  if (value == null) {
    return {comentario: null, error: null};
  }

  if (typeof value !== 'string') {
    return {comentario: null, error: 'O comentario informado e invalido.'};
  }

  const comentario = value.trim();

  if (comentario.length === 0) {
    return {comentario: null, error: null};
  }

  if (comentario.length > 500) {
    return {comentario: null, error: 'O comentario deve ter no maximo 500 caracteres.'};
  }

  return {comentario, error: null};
};

export const hashCpf = (cpf: string) => createHash('sha256').update(cpf).digest('hex');
