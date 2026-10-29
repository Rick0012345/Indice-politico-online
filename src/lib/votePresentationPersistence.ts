// Both ingestion and backfill use the same PostgreSQL assignments, evaluated
// against the previous row so copy and provenance are updated atomically.
export const votePresentationAssignments = (current: string, incoming: string) => {
  const sameInput = `${current}.ai_input_hash IS NOT DISTINCT FROM ${incoming}.ai_input_hash`;
  return [
    ...['titulo_publico', 'resumo_leigo'].map((column) =>
      `${column} = CASE WHEN ${sameInput} AND ${current}.ai_gerado_em IS NOT NULL THEN ${current}.${column} ELSE ${incoming}.${column} END`),
    ...['ai_model', 'ai_prompt_versao', 'ai_gerado_em'].map((column) =>
      `${column} = CASE WHEN ${sameInput} THEN ${current}.${column} ELSE NULL END`),
  ].join(',\n');
};
