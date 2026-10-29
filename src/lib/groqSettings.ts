export type GroqSettings = {groqApiKey: string; groqModel: string; enabled: boolean};
export const resolveGroqSettings = (
  settings: ReadonlyMap<string, string>,
  env: {GROQ_API_KEY?: string; GROQ_MODEL?: string} = process.env,
): GroqSettings => ({
  groqApiKey: env.GROQ_API_KEY?.trim() || '',
  groqModel: settings.get('groq_model')?.trim() || env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
  enabled: settings.get('groq_enabled') !== 'false',
});
