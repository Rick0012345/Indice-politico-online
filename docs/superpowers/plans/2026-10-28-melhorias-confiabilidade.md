# Melhorias de confiabilidade e desempenho

Objetivo: corrigir os achados da auditoria, priorizando totalização correta das despesas e consultas medidas como lentas. Autorização: pedido do usuário de 28/10/2026 após análise.

Arquitetura: manter React/Express/PostgreSQL. Reutilizar filtros SQL e contratos por domínio; nenhum cache é necessário antes de otimizar as consultas. Evoluir respostas de forma aditiva. Sem alteração de produção nem integração Gov.br inventada.

Contrato despesas: GET /api/politicos/:id/despesas aceita ano, mes, tipo (substring literal sem distinção de caixa), valorMin, valorMax, limit e offset. Responde {items,total,totalValor,tiposDisponiveis,hasMore}. total e totalValor são de TODO o resultado filtrado, não da página; tiposDisponiveis é do parlamentar/período, independente de tipo/valor. Ordenação ano DESC,mes DESC,id DESC. Valores negativos são legítimos (estornos). Entradas inválidas retornam 400.

- [x] 1. API: extrair consultas de despesas testáveis, filtros e agregados consistentes, comparar IDs numéricos, agregar gastos por parlamentar antes dos partidos. Testar contrato no PostgreSQL local isolado e medir antes/depois.
- [x] 2. Interface: consumir contrato de despesas, competência MM/AAAA, paginação protegida por contexto, estados de erro, atuação não consultada sem zero fictício, remover ação seguir sem implementação; modal acessível/responsivo; corrigir promessas Gov.br/fontes/atualização. Testes de comportamento e navegador.
- [x] 3. Importação e IA: lock de sessão PostgreSQL exclusivo para impedir limpeza durante processo ativo, cancelamento cooperativo e finalização sem reviver cancelados, dry-run sem escrita; preservar enriquecimento compatível e resolver configuração IA compartilhada. Testar sem APIs pagas ou ingestão externa.
- [x] 4. Operação: leitura de logs assíncrona e limitada; atualizar dependências vulneráveis compatíveis, configurar proxy/fallback Nginx, CI com TypeScript/testes/build e instruções locais coerentes.
- [x] 5. Revisão independente e integração: executar suíte completa, build, contratos no banco local, medidas comparativas e navegação desktop/celular incluindo falhas e troca de filtros. Corrigir achados e repetir validações afetadas.

Responsabilidade de arquivos: principal server.ts, consultas de despesas, infraestrutura, dependências e documentação; frente UI src/pages, src/components e utilitários cliente; frente worker scripts de ingestão/enriquecimento e auxiliares próprios. Preservar edições paralelas; sem commits automáticos, push ou publicação.

Riscos/transição: paginação mantém offset com desempate estável; total usa a mesma fotografia SQL dos itens. Lock impede limpeza inclusive após cancelamento, enquanto o processo drena. Configuração IA continua sem chave no banco. Acesso oficial de identidade é decisão futura: nesta entrega corrigir comunicação factual. Reversão: reverter diffs de aplicação; não transformar histórico. Testes e dados sintéticos usam somente o banco local de auditoria.

Validação concluída: 81 testes em 19 arquivos, incluindo PostgreSQL; TypeScript/build aprovados; npm audit com zero alertas; dez migrations aplicadas em banco vazio descartável; Nginx validado com rotas diretas e proxy; navegação desktop/mobile e falhas HTTP simuladas. Revisão independente concluída e achados corrigidos. Medições locais: gastos por partido 2597→402ms; resumo despesas164→14ms (medianas de cinco amostras após aquecimento).
