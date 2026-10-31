/** Process metadata is independent from proof of a conviction or imprisonment. */
export type ProceedingRole = 'DEFENDANT'|'RESPONDENT'|'INVESTIGATED'|'AUTHOR'|'APPELLANT'|'APPELLEE'|'PATIENT'|'WITNESS'|'OTHER';
export type ProceedingPhase = 'ACTION'|'INVESTIGATION'|'ENFORCEMENT'|'OTHER';
export type ProceedingIdentityEvidence = {method:'VERIFIED_CASE'|'OFFICIAL_CONTEXT'|'OFFICIAL_CASE_LINK';url:string;excerpt:string};
export type ProceedingObservation = {
  sourceId:'STF_CASES'; sourceKey:string; sourcePersonId:string|null;
  court:'STF'; caseNumber:string; cnjNumber:string|null;
  phase:ProceedingPhase; status:'ACTIVE'|'INACTIVE'|'UNKNOWN';
  filedAt:string|null; subjects:string[];
  roles:Array<{role:ProceedingRole;label:string}>;
  sourceUrl:string; sourceLabel:string; fetchedAt:string; contentHash:string;
  identity:'CONFIRMED'|'UNRESOLVED'; identityEvidence:ProceedingIdentityEvidence[];
};
export type ProceedingPage = {
  observations:ProceedingObservation[];
  /** All nominal hits, before filtering homonyms; not a public process count. */
  nominalMatches:number;
  /** Endpoint/page/detail failures must never masquerade as an empty search. */
  errors:string[];
};
export type ProceedingAnchor = {court:string;caseNumber:string;sourceUrl:string;excerpt:string};
export type ProceedingPerson = {id:string;nome:string;nomeCivil:string|null;birthDate?:string|null;anchors:ProceedingAnchor[]};
export type ProceedingCoverage = {
  status:'NOT_RESEARCHED'|'COMPLETE'|'PARTIAL'|'FAILED';
  scope:string; sourceLabel:string; sourceUrl:string;
  checkedAt:string|null; attemptedAt:string|null; unresolved:number;
};
export type ProceedingsSummary = {
  identified:number|null; againstPerson:number|null; activeAgainstPerson:number|null;
  investigations:number|null; enforcements:number|null; coverage:ProceedingCoverage;
};
export type JudicialProceeding = {
  id:string; court:string; caseNumber:string; cnjNumber:string|null;
  aliases:string[]; phase:ProceedingPhase; status:'ACTIVE'|'INACTIVE'|'UNKNOWN';
  filedAt:string|null; subjects:string[]; roles:Array<{role:ProceedingRole;label:string}>;
  countsAgainstPerson:boolean; sources:Array<{url:string;label:string}>; checkedAt:string;
};
