export const judicialCategories = {
  CRIMINAL: 'Criminal', IMPROBITY: 'Improbidade administrativa',
  ELECTORAL: 'Eleitoral', ACCOUNTS: 'Contas públicas',
} as const;
export type JudicialCategory = keyof typeof judicialCategories;
export const convictionStatuses = {
  FINAL: 'Definitiva', APPEAL: 'Sujeita a recurso',
  ANNULLED: 'Anulada', OVERTURNED: 'Revertida',
  SUSPENDED: 'Efeitos suspensos',
  PRESCRIBED: 'Punibilidade extinta por prescrição',
  UNKNOWN: 'Situação atual não identificada',
} as const;
export const custodyTypes = {
  FLAGRANT: 'Flagrante', TEMPORARY: 'Temporária', PREVENTIVE: 'Preventiva',
  SENTENCE: 'Cumprimento de pena', HOUSE_ARREST: 'Domiciliar',
  UNKNOWN: 'Modalidade não identificada',
} as const;
export type JudicialRecordInput = {
  kind: 'CONVICTION' | 'IMPRISONMENT';
  category: JudicialCategory;
  caseNumber: string;
  court: string;
  title: string;
  description: string;
  eventDate: string | null;
  convictionStatus: keyof typeof convictionStatuses | null;
  finalityDate: string | null;
  custodyType: keyof typeof custodyTypes | null;
  custodyConfirmed: boolean;
  releasedAt: string | null;
  grounds: string;
  outcome: string;
  sourceUrl: string;
  sourceLabel: string;
  sources?: Array<{url:string;label:string}>;
  automation?: JudicialAutomationMetadata;
  verification: 'DRAFT' | 'VERIFIED';
  /** Private evidence used by the reviewer; never included in public responses. */
  identityEvidence: string;
  reviewNote: string;
};
export type JudicialRecord = Omit<JudicialRecordInput, 'identityEvidence' | 'reviewNote' | 'automation'> & {
  id: string; politicoId: string; version: number; checkedAt: string | null; updatedAt: string;
};
export type JudicialAdminRecord = JudicialRecord & Pick<JudicialRecordInput, 'identityEvidence' | 'reviewNote' | 'automation'>;
export type JudicialCoverage = {
  status: 'NOT_RESEARCHED' | 'PARTIAL' | 'REVIEWED';
  scope: string;
  sources: Array<{label: string; url: string}>;
  checkedAt: string | null;
  version: number;
};
export type JudicialSummary = {
  proceedings?: import('./judicialProceedingsTypes').ProceedingsSummary;
  identifiedConvictions?: number | null;
  finalConvictions: number | null;
  appealConvictions: number | null;
  confirmedImprisonments: number | null;
  prisonHistory: 'CONFIRMED' | 'NO_RECORDS' | 'NOT_RESEARCHED';
  counts: Record<JudicialCategory, {final: number; appeal: number; identified?:number}>;
  coverage: JudicialCoverage;
  lastCheckedAt: string | null;
};
export type JudicialProfile = {
  summary: JudicialSummary;
  records: JudicialRecord[];
  cases?: import('./judicialProceedingsTypes').JudicialProceeding[];
};
export type JudicialAdminProfile = Omit<JudicialProfile, 'records'> & {records: JudicialAdminRecord[]};
export type JudicialRankingItem = {
  id: string; nome: string; partido: string; estado: string; foto: string | null;
  ativo: boolean; situacao: string | null; judicial: JudicialSummary;
};
export type JudicialRankingResponse = {
  items: JudicialRankingItem[]; total: number; totalCadastrados: number;
  coverage: {reviewed: number; partial: number; notResearched: number};
  revision: string;
};
import type {JudicialAutomationMetadata} from './judicialAutomationTypes';

/** Shared case identity; different tribunals may reuse the same process number. */
export function judicialCaseKey(value:{court:string;caseNumber:string}) {
  const clean=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const court=clean(value.court);
  return `${['STF','SUPREMOTRIBUNALFEDERAL'].includes(court)?'STF':['STJ','SUPERIORTRIBUNALDEJUSTICA'].includes(court)?'STJ':court}:${clean(value.caseNumber)}`;
}
