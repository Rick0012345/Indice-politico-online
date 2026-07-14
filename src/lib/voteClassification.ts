import {createHash} from 'node:crypto';

export type VoteClassificationType =
  | 'principal'
  | 'requerimento'
  | 'destaque'
  | 'emenda'
  | 'substitutivo'
  | 'parecer'
  | 'procedimental';

export type VoteClassificationConfidence = 'exata' | 'derivada' | 'ambigua';

export type VoteProposalCandidate = {
  id?: string | number | null;
  uri?: string | null;
  siglaTipo?: string | null;
  numero?: string | number | null;
  ano?: string | number | null;
  ementa?: string | null;
  efeito?: string | null;
};

export type VoteClassificationInput = {
  votacaoId?: string | null;
  descricao?: string | null;
  proposicaoObjeto?: string | null;
  uriProposicaoObjeto?: string | null;
  objetosPossiveis?: VoteProposalCandidate[] | null;
  proposicoesAfetadas?: VoteProposalCandidate[] | null;
};

export type VoteClassification = {
  tipoVotacao: VoteClassificationType;
  ehSubvotacao: boolean;
  tituloPublico: string;
  resumoLeigo: string | null;
  classificacaoFonte: 'oficial_direta' | 'regra_deterministica' | 'ambigua';
  classificacaoConfianca: VoteClassificationConfidence;
  classificacaoVersao: string;
  classificacaoJustificativa: string;
  proposicaoPrincipal: VoteProposalCandidate | null;
  objetoIdentificado: VoteProposalCandidate | null;
  inputHash: string;
};

export const VOTE_CLASSIFICATION_VERSION = '2026-07-14.1';

const PROCEDURAL_TYPES = new Set(['REQ', 'RPD', 'DTQ', 'EMP', 'EMC', 'SBT', 'PPP', 'PRLP', 'PEP', 'RDF']);
const MAIN_TYPES = new Set(['PEC', 'PLP', 'PL', 'MPV', 'MP', 'PDL', 'PRC', 'PLV']);

const cleanText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const searchable = (value: unknown) =>
  cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const asFiniteNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeCandidate = (candidate: VoteProposalCandidate): VoteProposalCandidate => ({
  id: candidate.id == null ? null : String(candidate.id),
  uri: cleanText(candidate.uri) || null,
  siglaTipo: cleanText(candidate.siglaTipo).toUpperCase() || null,
  numero: asFiniteNumber(candidate.numero),
  ano: asFiniteNumber(candidate.ano),
  ementa: cleanText(candidate.ementa) || null,
  efeito: cleanText(candidate.efeito) || null,
});

export const formatVoteProposalReference = (candidate: VoteProposalCandidate | null | undefined) => {
  if (!candidate) return null;
  const type = cleanText(candidate.siglaTipo).toUpperCase();
  const number = asFiniteNumber(candidate.numero);
  const year = asFiniteNumber(candidate.ano);
  if (!type || number == null || year == null || year <= 0) return null;
  return `${type} ${number}/${year}`;
};

const referenceFromText = (value: unknown): VoteProposalCandidate | null => {
  const text = cleanText(value);
  const match = text.match(/\b(PEC|PLP|PLV|PL|MPV|MP|PDL|PRC|REQ|RPD|DTQ|EMP|SBT)\s*(?:n[ºo.]*)?\s*([\d.]+)\s*\/\s*(\d{4})/i);
  if (!match) return null;
  return normalizeCandidate({
    siglaTipo: match[1].toUpperCase() === 'MP' ? 'MPV' : match[1].toUpperCase(),
    numero: Number(match[2].replace(/\D/g, '')),
    ano: Number(match[3]),
  });
};

const candidateKind = (candidate: VoteProposalCandidate): VoteClassificationType | null => {
  const type = cleanText(candidate.siglaTipo).toUpperCase();
  const text = searchable(candidate.ementa);
  if (type === 'DTQ' || text.includes('destaque para votacao')) return 'destaque';
  if (['EMP', 'EMC'].includes(type) || text.includes('emenda de plenario') || text.includes('subemenda')) return 'emenda';
  if (type === 'SBT' || text.includes('substitutiv')) return 'substitutivo';
  if (['PPP', 'PRLP', 'PEP', 'RDF'].includes(type) || text.startsWith('parecer')) return 'parecer';
  if (['REQ', 'RPD'].includes(type) || text.includes('requerimento')) return 'requerimento';
  if (MAIN_TYPES.has(type)) return 'principal';
  return null;
};

const inferKind = (description: string, directObject: VoteProposalCandidate | null): VoteClassificationType => {
  const text = searchable(description);
  if (text.includes('destaque')) return 'destaque';
  if (text.includes('subemenda') || /\bemenda\b/.test(text)) return 'emenda';
  if (text.includes('substitutiv')) return 'substitutivo';
  if (text.includes('parecer')) return 'parecer';
  if (text.includes('requerimento') || candidateKind(directObject ?? {}) === 'requerimento') return 'requerimento';
  if (/\b(projeto|proposta|medida provisoria)\b/.test(text)) return 'principal';
  return candidateKind(directObject ?? {}) ?? 'procedimental';
};

const actionKeyword = (description: string) => {
  const text = searchable(description);
  if (text.includes('urgencia')) return 'urgencia';
  if (text.includes('retirada') && text.includes('pauta')) return 'retirada';
  if (text.includes('adiamento') && text.includes('discussao')) return 'adiamento_discussao';
  if (text.includes('adiamento') && text.includes('votacao')) return 'adiamento_votacao';
  if (text.includes('encerramento')) return 'encerramento';
  if (text.includes('votacao nominal')) return 'nominal';
  if (text.includes('destaque')) return 'destaque';
  return null;
};

const matchesAction = (candidate: VoteProposalCandidate, action: string | null) => {
  if (!action) return true;
  const text = searchable(candidate.ementa);
  if (action === 'urgencia') return text.includes('urgencia');
  if (action === 'retirada') return text.includes('retirada') && text.includes('pauta');
  if (action === 'adiamento_discussao') return text.includes('adiamento') && text.includes('discussao');
  if (action === 'adiamento_votacao') return text.includes('adiamento') && text.includes('votacao');
  if (action === 'encerramento') return text.includes('encerramento');
  if (action === 'nominal') return text.includes('votacao nominal');
  if (action === 'destaque') return text.includes('destaque');
  return true;
};

const chooseMainProposal = (
  affected: VoteProposalCandidate[],
  possible: VoteProposalCandidate[],
  description: string,
) => {
  const candidates = [...affected, ...possible];
  const explicitMain = candidates.find((candidate) => MAIN_TYPES.has(cleanText(candidate.siglaTipo).toUpperCase()));
  if (explicitMain) return explicitMain;
  return referenceFromText(description) ?? candidates.find((candidate) => !PROCEDURAL_TYPES.has(cleanText(candidate.siglaTipo).toUpperCase())) ?? null;
};

const buildTitle = (
  kind: VoteClassificationType,
  description: string,
  main: VoteProposalCandidate | null,
  ambiguous: boolean,
) => {
  const reference = formatVoteProposalReference(main);
  const suffix = reference ? ` do ${reference}` : '';
  const action = actionKeyword(description);

  if (ambiguous && kind === 'procedimental') {
    return `Subvotação procedimental${reference ? ` relacionada ao ${reference}` : ''} — objeto exato não identificado`;
  }
  if (kind === 'requerimento') {
    const label =
      action === 'urgencia' ? 'Requerimento de urgência' :
      action === 'retirada' ? 'Requerimento de retirada de pauta' :
      action === 'adiamento_discussao' ? 'Requerimento de adiamento da discussão' :
      action === 'adiamento_votacao' ? 'Requerimento de adiamento da votação' :
      action === 'encerramento' ? 'Requerimento de encerramento da discussão' :
      action === 'nominal' ? 'Requerimento de votação nominal' :
      'Requerimento';
    return `${label}${suffix}`;
  }
  if (kind === 'destaque') return `Destaque para votação em separado${suffix}`;
  if (kind === 'emenda') return `Emenda${reference ? ` ao ${reference}` : ''}`;
  if (kind === 'substitutivo') return `Substitutivo${reference ? ` ao ${reference}` : ''}`;
  if (kind === 'parecer') return `Parecer${reference ? ` sobre o ${reference}` : ''}`;
  if (kind === 'principal') return reference ? `Votação principal do ${reference}` : 'Votação principal';
  return `Subvotação procedimental${reference ? ` relacionada ao ${reference}` : ''}${ambiguous ? ' — objeto exato não identificado' : ''}`;
};

const stableCandidates = (items: VoteProposalCandidate[]) =>
  items
    .map(normalizeCandidate)
    .sort((a, b) => `${a.id ?? ''}:${a.uri ?? ''}`.localeCompare(`${b.id ?? ''}:${b.uri ?? ''}`));

export const classifyVote = (input: VoteClassificationInput): VoteClassification => {
  const description = cleanText(input.descricao);
  const possible = stableCandidates(input.objetosPossiveis ?? []);
  const affected = stableCandidates(input.proposicoesAfetadas ?? []);
  const directReference = referenceFromText(input.proposicaoObjeto);
  const directId = cleanText(input.uriProposicaoObjeto).match(/\/(\d+)$/)?.[1] ?? null;
  const directFromCandidates = directId
    ? [...possible, ...affected].find((candidate) => String(candidate.id ?? '') === directId) ?? null
    : null;
  const directObject = directFromCandidates ?? directReference;
  const kind = inferKind(description, directObject);
  const action = actionKeyword(description);
  const sameKind = possible.filter((candidate) => candidateKind(candidate) === kind && matchesAction(candidate, action));
  const identifiedObject = directObject ?? (sameKind.length === 1 ? sameKind[0] : possible.length === 1 ? possible[0] : null);
  const main = chooseMainProposal(affected, possible, `${input.proposicaoObjeto ?? ''} ${description}`);
  const hasMultipleUnresolved = !identifiedObject && possible.length > 1;
  const ambiguous = hasMultipleUnresolved || (!identifiedObject && kind === 'procedimental');
  const confidence: VoteClassificationConfidence = hasMultipleUnresolved
    ? 'ambigua'
    : directObject
      ? 'exata'
      : identifiedObject || (kind !== 'procedimental' && main)
        ? 'derivada'
        : 'ambigua';
  const source = confidence === 'exata' ? 'oficial_direta' : confidence === 'ambigua' ? 'ambigua' : 'regra_deterministica';
  const effectiveKind = ambiguous && kind === 'principal' ? 'procedimental' : kind;
  const title = buildTitle(effectiveKind, description, main, ambiguous);
  const summary = description ? (description.length > 260 ? `${description.slice(0, 257).trim()}...` : description) : null;
  const canonicalInput = JSON.stringify({
    votacaoId: cleanText(input.votacaoId),
    descricao: description,
    proposicaoObjeto: cleanText(input.proposicaoObjeto),
    uriProposicaoObjeto: cleanText(input.uriProposicaoObjeto),
    objetosPossiveis: possible,
    proposicoesAfetadas: affected,
    version: VOTE_CLASSIFICATION_VERSION,
  });

  return {
    tipoVotacao: effectiveKind,
    ehSubvotacao: effectiveKind !== 'principal',
    tituloPublico: title,
    resumoLeigo: summary,
    classificacaoFonte: source,
    classificacaoConfianca: confidence,
    classificacaoVersao: VOTE_CLASSIFICATION_VERSION,
    classificacaoJustificativa:
      confidence === 'exata'
        ? 'Objeto identificado diretamente pelos dados oficiais.'
        : confidence === 'derivada'
          ? 'Tipo e proposição relacionados derivados de campos oficiais sem escolher candidato ambíguo.'
          : 'A fonte oficial não identifica de forma única o objeto desta subvotação.',
    proposicaoPrincipal: main,
    objetoIdentificado: identifiedObject,
    inputHash: createHash('sha256').update(canonicalInput).digest('hex'),
  };
};
