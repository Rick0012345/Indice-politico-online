export type VoteAiResponse = {titulo: string; resumo: string};

const normalize = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const proposalReferences = (value: string) =>
  Array.from(value.matchAll(/\b(PEC|PLP|PLV|PL|MPV|MP|PDL|PRC|REQ|RPD|DTQ|EMP|SBT)\s*(\d+)\s*\/\s*(\d{4})/gi))
    .map((match) => `${match[1].toUpperCase() === 'MP' ? 'MPV' : match[1].toUpperCase()} ${Number(match[2])}/${Number(match[3])}`);

export const parseAndValidateVoteAiResponse = (
  content: unknown,
  allowedReferences: string[],
): VoteAiResponse | null => {
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content) as {titulo?: unknown; resumo?: unknown};
    const titulo = normalize(parsed.titulo).slice(0, 140);
    const resumo = normalize(parsed.resumo).slice(0, 300);
    if (!titulo || !resumo) return null;

    const allowed = new Set(allowedReferences.map((reference) => normalize(reference).toUpperCase()));
    const introduced = proposalReferences(`${titulo} ${resumo}`)
      .filter((reference) => !allowed.has(reference.toUpperCase()));
    if (introduced.length > 0) return null;
    return {titulo, resumo};
  } catch {
    return null;
  }
};

