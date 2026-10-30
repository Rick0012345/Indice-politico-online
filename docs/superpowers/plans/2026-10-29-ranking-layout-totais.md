# Ranking: largura, leitura e totais

> Execução com superpowers:subagent-driven-development, frontend-design e ui-ux-pro-max, dimensionada ao escopo autorizado pelo usuário.

**Objetivo:** aproveitar a largura da tela e diferenciar parlamentares cadastrados, encontrados pelos filtros e carregados na lista.

**Arquitetura:** manter React/Tailwind, paginação de 50 e atualização pelo catálogo. Acrescentar `totalCadastrados` (global) e `total` (mesmos filtros da lista) ao endpoint existente. Preservar os consumidores de `items` e as proteções de concorrência. Não modificar dados históricos, ingestão ou produção.

**Direção visual:** manter Inter e a identidade azul/slate existente (#2563eb, #0f172a, #020617, #64748b, #f8fafc, #ffffff). Página fluida com margens responsivas, cabeçalho conciso, indicadores horizontais compactos, controles agrupados e tabela de maior densidade. Azul identifica a métrica selecionada; números alinhados e tabulares facilitam comparação. No celular, manter cards com rótulos e controles de toque. Evitar acrescentar fontes, bibliotecas e decoração sem função.

**Alternativas consideradas:** apenas remover o limite de largura deixaria os indicadores altos e a contagem errada; reestruturar toda a navegação ampliaria o escopo. Escolha técnica: reorganização localizada do ranking e alinhamento da barra de navegação somente nessa rota, sem mudar destinos ou fluxos.

## Restrições

- Preservar README.md, Admin.tsx e Admin.test.tsx preexistentes.
- Implementação local na branch atual; não fazer commit, push ou publicação.
- A contagem cadastrada não muda ao carregar mais nem ao filtrar; a contagem filtrada acompanha status e busca.
- Estatísticas de nota, gastos e votações devem dizer que se referem aos parlamentares carregados.
- Totais ausentes não devem ser substituídos pela quantidade da página; mostrar indisponibilidade explícita.

## Tarefas

- [x] Dados (agente): testar contagens global/filtrada, status, busca e página vazia; implementar extensão compatível da consulta e endpoint.
- [x] Interface (principal): teste de regressão com total maior que 50 e paginação/filtros; consumir metadados com as mesmas proteções contra respostas obsoletas; aplicar largura fluida, hierarquia, controles acessíveis e estados de dados.
- [x] Revisão e validação (agente independente): revisar contrato e concorrência, executar navegador em desktop e celular, temas claro/escuro, filtros, busca, partidos, paginação e links. Principal integra correções e executa testes, TypeScript e build.

## Foco da revisão

- Página vazia deve conservar contagens válidas; cargo sem dados deve explicar limitação sem inventar um total.
- Resposta antiga após troca de busca/status não pode sobrescrever contagens atuais.
- Carregar mais e atualizações do catálogo devem preservar extensão e não duplicar pessoas.
- Abas de partidos devem refletir gastos e não anunciar nota como ordenação.
- Tela de 390px sem rolagem horizontal; desktop de 1366px/1920px sem limite central de 1280px.

## Validações

Testes focados de ranking e backend; `npm test`, `npm run lint`, `npm run build`; conferência do endpoint contra contagem SQL somente leitura no banco local; screenshots e interação Playwright. Integrações sem configuração devem ser relatadas como não executadas.

## Transição e reversão

Contrato aditivo sem migration. Mudanças locais reversíveis por arquivo; nenhuma alteração no banco. Revisão final deve separar esta entrega das alterações administrativas preexistentes.

## Resultado verificado em 29/10/2026

- Suíte final com PostgreSQL local configurado: 34 arquivos e 165 testes aprovados, sem testes pulados; 11 casos novos de contrato do ranking.
- TypeScript (`npm run lint`), build e `git diff --check` aprovados.
- Consulta SQL e API local concordam: 949 cadastrados, 304 ativos e 645 inativos. Paginação real 50 → 100 manteve o total; busca por nome retornou 1/1; cargo sem dados retornou 0/0 com orientação.
- Revisão independente sem achados acionáveis; navegador em 1366px, 1920px e 390px, temas claro/escuro e sem overflow horizontal. Testados partidos, métricas, busca, status, cargo e navegação para perfil.
- Imagens da revisão preservadas na pasta de visualizações desta conversa.
