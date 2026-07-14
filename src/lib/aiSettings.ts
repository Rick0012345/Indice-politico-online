const GROQ_MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;

export const getGroqModelValidationError = (value: string) => {
  const model = value.trim();

  if (!model) return 'Informe o nome do modelo Groq.';
  if (/^(gsk_|bearer\s+)/i.test(model)) {
    return 'Este campo recebe o nome do modelo, não uma chave de API. Configure GROQ_API_KEY no arquivo .env.';
  }
  if (!GROQ_MODEL_PATTERN.test(model)) {
    return 'Nome de modelo inválido. Use somente letras, números, ponto, hífen, sublinhado, barra ou dois-pontos.';
  }

  return null;
};
