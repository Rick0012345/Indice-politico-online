# Atributos judiciais integrados

> Execução com superpowers:subagent-driven-development; autorização: pedido do usuário para integrar condenações aos dados de cada político.

**Objetivo:** apresentar condenações e histórico de prisão junto com os atributos parlamentares, removendo a navegação judicial separada.

**Arquitetura:** reutilizar registros, validação e resumo judicial existentes. Enriquecer respostas parlamentares em lote, ordenar condenações no servidor antes da paginação e usar a mesma informação no ranking, perfil e comparação. Sem nova dependência ou migration.

**Decisão de apresentação:** Condenações passa a ser opção em Comparar por, junto com Nota, Gastos e Votações. A tabela/cartão mostra seus atributos judiciais em todas as ordenações. No perfil, resumo permanente e detalhes na Visão Geral. A nota popular mantém sua regra.

**Compatibilidade:** URLs antigas `view=judicial` e `tab=judicial` direcionam à apresentação integrada, preservando filtros aplicáveis. Rotas antigas permanecem compatíveis. Reversão pelo código, sem apagar registros. Não alterar a ingestão nesta correção de apresentação.

## Contratos e restrições

- `judicial: JudicialSummary` nas respostas de políticos; somente dados publicados.
- `metric=condenacoes`, `category=CRIMINAL|IMPROBITY|ELECTORAL|ACCOUNTS` e `prisonOnly=true` no ranking parlamentar.
- Pesquisa desconhecida continua null e não recebe posição por condenações; pesquisado sem resultados pode ter zero limitado ao escopo.
- Recursos, anulações e prisões não entram na contagem definitiva. Sem somar categorias distintas por padrão.
- Preservar totais/ordenação/paginação/atualizações dos gastos e dados existentes.
- Branch atual de trabalho: `codex/judicial-integrado`; sem commit, push ou publicação.

## Entregas e validação

- [x] Backend: atributos judiciais em lote nas rotas parlamentares; ordenação global, filtros e resumo consistente; testes PostgreSQL isolados e unitários de consulta.
- [x] Ranking: remover alternador de páginas; coluna e atributo móvel; opção de ordenação; categoria e prisão; CSV; links legados; testes de comportamento.
- [x] Perfil/comparador: atributos permanentes, detalhes na visão geral, link legado, unknown/erro; testes de comportamento.
- [x] Documentação e remoção de componente judicial de ranking sem consumidores.
- [x] Revisão independente, testes integrados, TypeScript/build e navegador desktop/360px com captura visual.

## Focos de revisão

1. Ordenação antes da paginação e desconhecidos ao fim inclusive ordem crescente.
2. Filtros e total da mesma população; respostas antigas não contaminam novo contexto.
3. Duplicação de regras judiciais ou consultas por linha; dados privados nunca expostos.
4. Ausência de dados não vira zero nem afirma nunca ter sido preso.
5. Atributos visíveis no ranking normal e perfil inicial; links antigos e exportação consistentes.

## Resultado verificado

- 113/113 testes passaram na rodada integrada, sem pendentes; relatório `output/judicial-integrated/tests.json`. PostgreSQL exclusivamente em `app_test`, schemas isolados.
- `npm run lint`, `npm run build` e `git diff --check` passaram.
- Revisão independente apontou duas correções incorporadas: snapshot compartilhado entre ordenação e enriquecimento (`READ ONLY REPEATABLE READ`, com teste concorrente determinístico) e rótulo de cobertura no ranking. Revisão das correções sem achados restantes.
- Chromium em 1440px e 360px: sem nova navegação judicial, dados judiciais junto dos gastos, filtros e URLs legadas funcionais, perfil geral e comparador, sem overflow horizontal no documento. Evidências em `output/judicial-integrated/`.
- Nenhum registro judicial real inserido, nenhuma migração, commit, push ou publicação externa. A ingestão automática permanece pendente, fora desta correção de apresentação.
