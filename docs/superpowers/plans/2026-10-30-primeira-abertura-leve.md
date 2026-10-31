# Primeira abertura leve — plano de implementação

> **Para execução por agentes:** usar `superpowers:executing-plans` ou `superpowers:subagent-driven-development` conforme a divisão efetiva do trabalho. Delegar validação de interface e revisão independente; modelo/esforço dentro das regras do usuário.

**Status:** proposta para avaliação. Este trabalho autoriza planejamento, não implementação ou publicação.

**Objetivo:** reduzir a espera na primeira abertura do site, prioridade confirmada pelo usuário, preservando funcionalidades e a precisão dos dados.

**Arquitetura proposta:** reaproveitar os alvos `production` e `api-production` do Dockerfile e a configuração Nginx existentes para oferecer execução local compilada. Manter desenvolvimento separado; reduzir trabalho de varredura de arquivos, dependências da primeira tela e consultas comprovadamente lentas. Evoluir os contratos atuais de cache e carregamento progressivo.

**Tecnologias:** React 19, Vite 6, Tailwind 4, Express, PostgreSQL 16, Docker Compose e Nginx, sem atualização geral de versões.

**Desenho e requisitos:** definidos neste documento; proposta técnica do agente, ainda não aprovada para execução.

## Evidências e limites

Inspeção em 30/10/2026, branch `codex/judicial-integrado`, com alterações preexistentes preservadas.

- Os três containers estavam ativos nesta investigação; banco saudável. A interface executava Vite de desenvolvimento e a API `tsx watch`.
- Compose monta o repositório Windows em `/app` e habilita polling de 100 ms. Isso é candidato a custo de I/O; não foi isolado como causa.
- GET `/` no host `127.0.0.1:3000` expirou após 10 s sem bytes; em `localhost:3000`, após 30 s. Dentro do container da interface, `/` e `/src/main.tsx` também expiraram no limite de 8 s. O problema observado antecede a renderização React; a causa exata do bloqueio do Vite permanece aberta.
- Pela API interna, `/api/catalogo/revision` respondeu em 795 ms e `ranking?view=cards&filter=best&limit=4&status=exercicio` em 1.390 ms, 5.448 bytes. `view=items&limit=50` e `view=summary` excederam o limite de 15 s do diagnóstico. Amostras isoladas, parâmetros de sondagem, sem estimativa de percentis ou causalidade exclusiva de SQL.
- Em uma amostra do PostgreSQL havia uma consulta aguardando `DataFileRead`; em outra não havia consulta ativa externa. Isso é indício de espera de I/O, não comprovação de falha do SSD nem de falta de memória.
- Rotas já usam `React.lazy`; Home/Ranking/Comparador já têm carregamento independente; `catalogResource.ts` oferece cache de 30 s e deduplicação. Nginx já tem gzip, cache de assets e exceção correta para SSE. Preservar e reutilizar.
- `src/index.css` importa Google Fonts por `@import`. Existe uma cadeia externa de fontes a avaliar.
- `output/` contém 12.450 arquivos listados pelo `rg`, não está excluído de `.gitignore` nem `.dockerignore`; inclui artefatos de outras tarefas. Tailwind usa detecção automática sem delimitação explícita de fontes. A participação efetiva desses arquivos na lentidão precisa de comparação controlada.
- Consultas de itens ainda incluem agregados de despesas/votos; consultas judiciais já são feitas em lote, mas a agregação processual tem subconsultas globais antes do filtro externo por IDs. Validar plano real antes de reescrever.
- Arquivos `dist/assets` preexistentes incluem aproximadamente 290 kB de JS principal e 80 kB de CSS, sem compressão. Não houve novo build: tamanho/atualidade desse artefato não é baseline confiável da revisão atual.
- Tentativa de navegação automatizada não produziu métricas utilizáveis nesta investigação. Não há LCP, tempo de tela completa ou prova visual atual. Não foram executados testes funcionais nem mudanças na aplicação.

## Escolha proposta

1. **Ajuste mínimo:** reduzir varreduras e polling do desenvolvimento. Menor alteração, mas mantém transformação de módulos durante o uso.
2. **Recomendado:** corrigir a resposta inicial e acrescentar execução compilada local, depois otimizar apenas o caminho crítico medido. Reaproveita infraestrutura existente e melhora a representatividade dos testes de uso.
3. **Adiado:** SSR, troca de framework, Redis ou materialização abrangente. A evidência atual não justifica esse custo.

## Restrições globais

- Não remover dados, volumes, artefatos de outras tarefas nem funcionalidades para ganhar velocidade.
- Não reiniciar serviços, executar migrations ou publicar durante a etapa de planejamento.
- Preservar dados desconhecidos como desconhecidos, cobertura judicial, filtros, totais, ordenação global e desempates antes da paginação.
- Não tratar skeleton como conteúdo útil nem cache aquecido como primeira visita.
- Não colocar respostas administrativas no cache público. Não adicionar cache ao stream SSE.
- Preservar os contratos `fetchCatalogJson<T>(url, {signal?, force?})`, revisões e cancelamento por consumidor.
- Não adicionar dependências ou abstrações gerais sem necessidade demonstrada.

## Tarefa 1 — Baseline reproduzível e localização do bloqueio inicial

**Arquivos:** criar `scripts/measure-first-load.mjs` e `output/diagnostics/first-load-baseline.json`; consultar `vite.config.ts`, `src/index.css`, `docker-compose.yml`, `src/server.ts` e logs do Docker.

- [ ] Medir separadamente host → interface, interface interna, host → API e API → banco; limitar duração e concorrência, registrando timeout como timeout, sem convertê-lo em tempo de conclusão.
- [ ] Registrar revisão do código, alterações locais, estado do Docker, reinício recente, CPU/RAM e atividade de ingestão, sem expor credenciais.
- [ ] Investigar Vite/transformação CSS, leitura do bind mount e varreduras. Comparar mesma fonte em cópia temporária limpa e ambiente equivalente antes de atribuir causa ao polling ou SSD.
- [ ] Após obter HTML estável, medir Home em cinco contextos novos de navegador, cache do navegador vazio; medir separadamente processo recém-iniciado e servidor aquecido. Capturar requests, bytes transferidos, TTFB, FCP, LCP, primeiro card real e erros.
- [ ] Medir segunda navegação separadamente. Usar evento do conteúdo e recursos finitos; não aguardar `networkidle`, pois há SSE.

**Aceite:** baseline repetível e camada responsável identificada, ou bloqueio explicitamente documentado. Não avançar alegando ganho sem referência válida.

## Tarefa 2 — Limitar varredura e empacotamento ao necessário

**Arquivos:** `vite.config.ts`, `src/index.css`, `.dockerignore`; verificar `.gitignore` sem usá-lo para ocultar entregas de outras tarefas.

- [ ] Delimitar as fontes do Tailwind à aplicação e ao `index.html`, usando sintaxe compatível com a versão instalada. Excluir artefatos, backups e resultados da observação do Vite.
- [ ] Tirar `output/`, logs e evidências do contexto de build, após conferir que não são dependências reais; não apagar os arquivos.
- [ ] Ajustar polling somente se a comparação da tarefa 1 comprovar custo; validar que editar TSX/CSS ainda atualiza o navegador no Windows.
- [ ] Executar build e comparar tamanho do contexto, duração e primeira resposta em condições equivalentes. Validar estilos das páginas públicas, admin e componentes condicionais em modo claro/escuro e larguras 390/1366 px.

**Aceite:** nenhum estilo ausente, atualização de desenvolvimento funcional e redução medida do trabalho desnecessário.

## Tarefa 3 — Execução compilada local para uso cotidiano

**Arquivos:** criar `docker-compose.runtime.yml`; reutilizar `Dockerfile`, `nginx.conf`; documentar comandos em `README.md`.

- [ ] Usar imagem do frontend com alvo `production`, porta externa 3000 para porta interna 80, e API `api-production` na rede com alias `api`. Sem bind mount do código nem watchers nesse modo.
- [ ] Definir Compose independente com nome de projeto/volumes explícitos. Primeiro validar com banco de teste e porta alternativa; não conectar inadvertidamente um volume vazio nem iniciar duas instâncias sobre o mesmo volume PostgreSQL.
- [ ] Documentar troca de modo preservando o volume existente. A API existente aplica migrations na inicialização: conferir compatibilidade e migrations pendentes antes de qualquer troca real, com backup quando necessário.
- [ ] Reutilizar gzip/cache/SSE do Nginx; conferir HTML sem cache persistente, assets versionados, `/api/`, stream, navegação direta e atualização da página.
- [ ] Medir o mesmo protocolo da tarefa 1; verificar que o artefato servido corresponde à revisão construída.

**Aceite:** inicialização completa, Home utilizável, API funcional, rotas diretas funcionando, atualização de catálogo preservada e retorno ao modo desenvolvimento documentado.

## Tarefa 4 — Reduzir dependências da primeira tela

**Arquivos:** `src/index.css`, `index.html`, `src/pages/Home.tsx`, `src/components/Layout.tsx`, eventualmente `public/fonts/`; testes existentes `src/pages/Home.test.tsx`.

- [ ] Inspecionar waterfall e bundle atual. Preservar lazy loading existente; confirmar que admin, gráficos e modal de avaliação ficam fora da primeira abertura da Home.
- [ ] Remover importação remota bloqueante de fontes: preferir WOFF2 local com licença preservada, apenas famílias/pesos usados e fallback compatível. Pré-carregar somente a fonte comprovadamente crítica.
- [ ] Garantir tamanho reservado e decodificação adequada das fotos; adiar apenas imagens fora da área visível. Priorizar imagem somente se for o elemento LCP medido.
- [ ] Usar placeholder local estável para foto ausente, sem consulta externa aleatória, preservando identidade e acessibilidade.
- [ ] Testar fonte/foto externa indisponível, rede lenta, erro parcial de uma lista e repetição por bloco. Conteúdo principal deve continuar utilizável.

**Aceite:** primeira tela sem dependência obrigatória de serviços externos, sem regressão visual ou acessível, com melhoria de bytes/tempo demonstrada.

## Tarefa 5 — Dados iniciais e consultas lentas comprovadas

**Arquivos:** `src/server.ts`, `src/lib/rankingQueries.ts`, `src/lib/judicialRepository.ts`, `src/lib/judicialProceedingsRepository.ts`, `src/lib/catalogResource.ts`; testes correspondentes de ranking/judicial/cache.

- [ ] Capturar parâmetros reais da Home e medir cada etapa: espera por conexão, SQL principal e enriquecimento judicial. Inspecionar `EXPLAIN (ANALYZE, BUFFERS)` apenas de SELECTs delimitados, com timeout e sem carga concorrente artificial.
- [ ] Para resumos de uma página, restringir agregação processual aos IDs solicitados, se o plano mostrar varredura global. Reutilizar a regra central de contagem canônica; comparar saída antiga/nova.
- [ ] Se consultas idênticas públicas continuarem caras, implementar deduplicação/cache limitado no servidor, chaveado por rota, filtros normalizados e revisão. Invalidar somente após alterações confirmadas e testar todos os escritores relevantes; não servir resultado antigo como revisão nova.
- [ ] Otimizar gastos/votos e resumo completo somente quando afetarem a Home ou a navegação medida. Avaliar índices com base no plano; não criar agregações persistidas automaticamente.
- [ ] Rodar testes de igualdade de totais, ordenação global, categorias, cobertura desconhecida, paginação e filtros combinados em `app_test`. Testar alteração durante consulta e cancelamento independente dos consumidores.

**Aceite:** benefício mensurado, dados idênticos e sem vazamento administrativo ou inconsistência de revisão. Se o gargalo da Home estiver resolvido antes, tratar Ranking como etapa secundária, sem ampliar esta entrega silenciosamente.

## Tarefa 6 — Verificação, revisão e entrega

- [ ] Rodar os testes afetados, `npm run lint` e `npm run build`. Se cópias em `output` afetarem descoberta de testes/TypeScript, reportar e usar escopo real de fontes; não remover evidências para passar.
- [ ] Delegar verificação de interface e revisão independente da mudança material; preservar alterações paralelas. Corrigir achados e repetir apenas verificações afetadas.
- [ ] Comparar cinco execuções de primeira visita antes/depois, publicando mediana e pior execução; cinco amostras não caracterizam p95 de produção.
- [ ] Metas propostas em navegador desktop local, cache vazio, serviços prontos e sem ingestão concorrente: HTML em até 500 ms, conteúdo principal em até 2 s e primeiro bloco real em até 3 s. São critérios a validar, não garantias. Medir também dispositivo móvel emulado com rede/CPU limitadas e parâmetros registrados.
- [ ] Aceitar somente sem timeout, regressão funcional, estilos ausentes ou conteúdo antigo apresentado como atual. Reportar limites do ambiente local; não inferir desempenho público.

## Transição e reversão

Implementar por etapas em alterações delimitadas. Manter o Compose de desenvolvimento disponível. Testar runtime em porta alternativa antes da troca. Para reverter runtime, parar seus serviços e voltar ao Compose anterior com o mesmo volume validado, nunca `down -v`. Reverter otimizações de código pelo diff específico, preservando trabalho paralelo e dados. Qualquer índice novo deve ter plano próprio de aplicação/reversão. Publicação permanece fora do escopo.

## Revisão do plano

Focos cobertos nas tarefas: cache vazio e reinício (1/3), estilos condicionais e responsividade (2/4), falha de fonte/imagem/API (4), atualização durante consulta e concorrência (5), troca de runtime com volumes/migrations (3/6). Não duplicar melhorias já presentes nem prometer que tamanho de bundle explica os timeouts observados.

## Referências técnicas

- [Vite: build para distribuição estática](https://vite.dev/guide/build.html).
- [Tailwind: delimitação de fontes para detecção de classes](https://tailwindcss.com/docs/detecting-classes-in-source-files) — conferir recursos na versão instalada antes de aplicar.
- [web.dev: carregamento e entrega de fontes](https://web.dev/articles/font-best-practices).
- Plano anterior local: `docs/superpowers/plans/2026-10-30-carregamento-progressivo.md`.
