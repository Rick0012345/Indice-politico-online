// Earliest common period supported by the current deputy/expense collectors.
// This is not the beginning of the Chamber's complete historical archive.
export const INGESTION_SUPPORTED_FROM = '2015-01-01';

const civilDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getDefaultIngestionPeriod(now = new Date()) {
  const parts = Object.fromEntries(civilDate.formatToParts(now).map(part => [part.type, part.value]));
  return {from: INGESTION_SUPPORTED_FROM, to: `${parts.year}-${parts.month}-${parts.day}`};
}
