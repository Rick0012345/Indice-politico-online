# Indicadores claros e coerentes da ingestão

> Execução local pelo agente principal, com revisão independente e validação de interface delegadas ao final. Aplicar TDD e verificação antes da conclusão.

**Objetivo:** explicar o estado atual da execução e os totais acumulados de tarefas sem percentuais estimados ou mensagens contraditórias.

**Arquitetura:** manter os checkpoints e os contratos de execução existentes. Acrescentar ao resumo uma leitura sem mutação da atividade do processo gerenciado e do lock compartilhado. Centralizar a agregação e apresentar um componente de progresso reutilizado nas abas Coleta e Progresso.

**Tecnologias:** React, TypeScript, Express, PostgreSQL e Vitest; sem novas dependências.

## Contexto e decisões

- A estimativa atual considera apenas deputados e votações, mas compara com tarefas históricas de outros conjuntos. Remover a barra de criação da fila: o tamanho cresce ao descobrir novos recursos e não há denominador confiável.
- A contagem de grupos não é contagem de tarefas. Exibir tarefas por estado e informar o escopo acumulado, independente das datas/categorias selecionadas para uma nova coleta.
- Conclusões com e sem registros são partes disjuntas do total concluído. Uma consulta vazia não é falha.
- Checkpoints `running` não comprovam sozinhos que um agente permanece ativo. O lock também protege enriquecimento e limpeza; nunca tratá-lo isoladamente como prova de coleta.
- A atualização automática deve permanecer ativa na sessão autorizada, inclusive em fila vazia e quando o agente começa em outra janela. Não derivar seu rótulo de um booleano modificado apenas pelo botão Iniciar.
- Falhas de leitura preservam os últimos números e tornam explícito que estão desatualizados. A tela inicial não pode afirmar conclusão antes da primeira leitura.
- Reutilizar o checkout `codex/judicial-integrado`, preservando as alterações preexistentes de integridade/rastreabilidade. A etapa inicial foi local; commit e publicação foram autorizados pelo usuário na continuação desta tarefa.

## Critérios de aceitação e revisão

1. O cenário 77.003 concluídas / 77.006 totais mostra 42.212 com registros, 34.791 sem registros, 2 em processamento e 1 aguardando, sem somas ambíguas.
2. Atualização automática real a cada cinco segundos, sem sobreposição nem reinício de temporizador por resposta; encerra ao sair da sessão.
3. Agente ativo sem checkpoint ainda aparece como preparação/execução; fila pendente sem agente aparece aguardando execução; `running` órfão não afirma agente trabalhando.
4. Mesmos totais e significado nas abas Coleta e Progresso; seleção do formulário não altera o progresso histórico.
5. Estados inicial, vazio, concluído, falha de consulta e recuperação; responsividade em desktop e celular, sem dependência exclusiva de cores.

## Tarefas

- [x] 1. Criar regressões para agregação, atividade e estados do resumo; executar e confirmar falhas esperadas.
- [x] 2. Acrescentar atividade de execução ao resumo de forma somente leitura, reutilizando a identificação do lock em `ingestionLifecycle.ts`; validar contrato do endpoint e isolamento por banco.
- [x] 3. Substituir o bloco confuso por componente acessível com status, contagens e percentual explicitamente acumulados; compartilhar agregação com os cartões por categoria.
- [x] 4. Unificar atualização automática, informar carregamento/falha e impedir leituras concorrentes/indefinidas; cobrir início fora da sessão e retomada de conexão.
- [x] 5. Executar testes afetados, TypeScript e build; revisão independente e navegador desktop/celular; corrigir achados e repetir verificações afetadas.

## Limites, transição e reversão

A resposta da API recebe campo aditivo; clientes anteriores continuam compatíveis. Clientes novos sem o campo indicam execução não confirmada. Não há migração de dados. Reversão pelos arquivos da mudança. Docker está indisponível nesta sessão: não reativar o ambiente; validar banco apenas se já houver conexão disponível, senão declarar a limitação e usar testes de contrato.

## Evidências de execução

- Base: 24 testes existentes aprovados antes da implementação; novas regressões falharam antes das correções.
- Validação final afetada: 36 testes aprovados; 15 de PostgreSQL não executados por ausência de `TEST_DATABASE_URL` e Docker desligado. O teste HTTP cobre contrato e autorização com pool controlado; não substitui execução SQL real.
- `npm run lint`, `npm run build` e `git diff --check` aprovados ao final, após a correção do achado da revisão.
- Navegador real com respostas controladas: cenário 77.003/77.006, fila vazia, polling, execução sem tarefas, checkpoint órfão, manutenção, erro 503 e recuperação; desktop 1440px e celulares 390/320px em temas claro/escuro. Sem erros de página nem overflow no resumo. Evidências: `output/playwright/ingestion-progress-results.json` e capturas de mesmo prefixo.
- Revisão independente: identificou o botão Atualizar logs contornando a trava de atualização. Regressão demonstrou duas consultas concorrentes; corrigido para compartilhar `refreshAdminData`, conferido novamente pelo revisor e aprovado no teste final.
- Decisão: resumo movido acima do formulário e compartilhado pelas abas Coleta/Progresso, para não parecer restrito à próxima coleta.
- Alterações paralelas de integridade/rastreabilidade surgiram durante a sessão e foram preservadas, inclusive em `src/server.ts`. Não houve commit, push, publicação nem mutação de dados.

## Continuação autorizada: commit e publicação

O usuário solicitou explicitamente commit e deploy para disponibilizar a correção online. Publicar somente os arquivos dos indicadores, incluindo apenas os dois trechos pertinentes de `src/server.ts`; manter a funcionalidade paralela de integridade fora da versão.

- [ ] Criar commit específico e pacote derivado desse commit, com manifesto de hashes e sem arquivos privados.
- [ ] Confirmar saúde da VPS e ausência de ingestão pesada; criar backup antes de promover a versão.
- [ ] Construir imagens sequencialmente sob os limites existentes e validar a versão exata em banco de teste separado.
- [ ] Promover apenas API/web do projeto `indice-politico`, mantendo banco, porta HTTPS, dados persistentes e serviços PFC/Vínculo.
- [ ] Conferir revisão das imagens, endpoints públicos e autenticados, resumo no navegador e preservação dos serviços/dados.

Reversão: preservar imagens e referência da release anterior; em falha, restaurar somente API/web e a referência `current`, sem restaurar banco ou remover volumes. Esta correção não altera migrações.

Consulta prévia da VPS: release `20261031-e458baf90614`, cinco containers saudáveis, 1.252 políticos e 1.303.072 despesas. Duas tarefas de deputados marcadas `running` e uma `pending`, mas zero locks de manutenção e nenhum worker ativo; confirmado o cenário que exige status de execução não confirmada. Evidência operacional em `output/deployment-ingestion/preflight.json`.
