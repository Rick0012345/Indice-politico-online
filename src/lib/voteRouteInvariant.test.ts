import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const serverSource = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
const ingestionSource = readFileSync(resolve(process.cwd(), 'src/ingest-agent.ts'), 'utf8');

describe('invariantes da arquitetura de votações', () => {
  it('não executa IA ou chamada HTTP externa na listagem pública', () => {
    const start = serverSource.indexOf("app.get('/api/politicos/:politicoId/votacoes'");
    const end = serverSource.indexOf("app.get('/api/votacoes/:votacaoId'", start);
    const route = serverSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(route).not.toMatch(/fetch\s*\(|groq|buildAiVoteSummary|getPublicVoteText/i);
  });

  it('consulta o detalhe oficial e mantém votos sem deputado em pendência', () => {
    expect(ingestionSource).toMatch(/fetchDetail<VoteSession>\(`\/votacoes\/\$\{voteSessionSummary\.id\}`/);
    expect(ingestionSource).toContain('votos_deputados_pendentes');
    expect(ingestionSource).toContain('reconcilePendingVotes');
    expect(ingestionSource).toContain('AND period_start >= $3::date');
  });
});
