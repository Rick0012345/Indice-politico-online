import type {JudicialRecordInput} from './judicialTypes';
import type {JudicialEvidence} from './judicialEvidence';
import type {JudicialAutomationResult} from './judicialAutomationTypes';
import type {JudicialArchiveScope} from './judicialArchive';

export const judicialIngestionSources = {
  STF_CASES: {label: 'STF — consulta processual', scope: 'Processos públicos identificados no STF, em tramitação e fora de tramitação. Não abrange todo o Judiciário nem os processos omitidos da consulta pública.'},
  STF_NEWS: {label: 'STF — acervo de notícias', scope: 'Pesquisa textual no acervo do STF; não equivale a consulta processual completa.'},
  STJ_NEWS: {label: 'STJ — notícias recentes', scope: 'Somente os documentos disponíveis no RSS do STJ no momento da coleta.'},
} as const;
export type JudicialSourceId = keyof typeof judicialIngestionSources;
export type JudicialIngestionPerson = {id: string; nome: string; nomeCivil: string | null};
export type JudicialSourceDocument = {
  sourceId: JudicialSourceId; sourceKey: string; url: string; title: string; text: string;
  publishedAt: string | null; modifiedAt: string | null; contentHash: string;
  raw: unknown; matchedNames: string[]; signals: Array<'CONVICTION' | 'CUSTODY' | 'REVERSAL'>;
};
export type JudicialSourcePage = {
  proceedings?: import('./judicialProceedingsTypes').ProceedingPage;
  documents: JudicialSourceDocument[];
  /** Nonqualifying snapshots may update an existing association, never create one. */
  observedDocuments?: JudicialSourceDocument[];
  hasMore: boolean; scope: string;
};
export type JudicialPageCollector = (source: JudicialSourceId, person: JudicialIngestionPerson, page: number, signal: AbortSignal) => Promise<JudicialSourcePage>;
export type JudicialIngestionConfig = {
  sources: JudicialSourceId[]; politicoIds?: string[]; status: 'ativo' | 'todos';
  afterId: string | null; maxPoliticians: number; maxPages: number;
};
export type JudicialIngestionRun = {
  lastError?: string|null;
  sourceTruncated?: boolean;
  archive?: JudicialArchiveScope;
  automation?: JudicialAutomationResult;
  active?: boolean;
  id: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  config: JudicialIngestionConfig; cursor: {personIndex: number; sourceIndex: number; page: number};
  people: JudicialIngestionPerson[]; processedPages: number; candidatesFound: number;
  errors: Array<{politicoId: string; source: JudicialSourceId; message: string}>;
  truncated: boolean; nextPoliticoId: string | null; hasMorePoliticians: boolean;
  cancelRequested: boolean; heartbeatAt: string | null; startedAt: string | null; finishedAt: string | null;
};
export type JudicialCandidate = {
  id: string; politicoId: string; politicoName: string; sourceId: JudicialSourceId;
  document: Omit<JudicialSourceDocument, 'raw'>; status: 'PENDING' | 'IMPORTED' | 'DISMISSED';
  version: number; recordId: string | null; contentChanged: boolean;
  firstSeenAt: string; lastSeenAt: string; reviewNote: string;
  /** Evidence attributed to this person; not an assertion of current legal status. */
  evidence?: JudicialEvidence[];
};
export type JudicialCandidateImport = JudicialRecordInput & {expectedVersion: number; candidateVersion: number; recordId: string};
