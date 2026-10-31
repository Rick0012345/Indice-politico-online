import type {JudicialRecordInput} from './judicialTypes';

export type JudicialExtractedFact = Omit<JudicialRecordInput, 'verification'|'identityEvidence'|'reviewNote'|'sources'|'automation'> & {
  /** Verbatim excerpts supporting the attributed event and the process identifier. */
  eventEvidence: string;
  caseEvidence: string;
  supportingEvidence?: string[];
};
export type JudicialExtraction = {facts: JudicialExtractedFact[]; issues: string[]};
export type JudicialAutomationMetadata = {
  version: string;
  candidateIds: string[];
  documentHashes: string[];
  proceduralEvidence?: {
    sourceUrl: string; snapshotHash: string; lookupSnapshotHash: string;
    caseNumber: string; movementDate: string; eventEvidence: string;
  };
};
export type JudicialAutomationResult = {created: number; updated: number; unchanged: number; unresolved: number; cases: number};
