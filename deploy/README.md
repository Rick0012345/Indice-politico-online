# Índice Político na Contabo

Endereço inicial: https://207.180.239.208:9443. PFC/Vínculo continua em HTTPS 443.

## Estrutura e recursos

- `/opt/indice-politico/.env`: credenciais exclusivas, acesso root, nunca versionar.
- `/opt/indice-politico/current`: release ativa; código do workspace identificado por `source-manifest.json`.
- `/opt/indice-politico/data/output` e `data/logs`: acervos, caches e logs persistentes; UID/GID 1000 para a API.
- Projeto/rede Docker `indice-politico`; volume `indice-politico_database`; PostgreSQL 16 próprio, sem porta pública.
- API: 3 GiB, 2 CPUs, heap Node de 1536 MiB por processo para suportar os documentos judiciais grandes. Banco: 1792 MiB, 1,5 CPU. Web: 128 MiB, 0,25 CPU. Total: 4992 MiB. Os subprocessos da API compartilham seu limite.
- PFC: app 768 MiB e banco 1280 MiB, total 2 GiB. Configuração operacional atual do PFC e containers atualizados sem reiniciar; preservar esses valores ao gerar novas releases do PFC. Cópia anterior em `/opt/vinculo/resource-policy/compose-before.yaml`.
- Restam aproximadamente 901 MiB fora dos tetos dos containers para Linux/Docker/nginx. Limites são tetos, não reservas físicas de memória.
- Build executado na VPS com 1536 MiB e 1,5 CPU; não executar múltiplos builds simultâneos nem junto com ingestões pesadas.

## Segurança e proxy

Somente web publica `127.0.0.1:3080`. Nginx do host atende 9443 com o certificado existente do IP. Renovação Certbot existente recarrega nginx; nenhum certificado/chave é copiado para o projeto.

Host nginx sobrescreve X-Forwarded-For com o cliente real; web nginx acrescenta o peer. API confia exatamente em dois proxies quando `TRUST_PROXY_HOPS=2`; não expor a API diretamente nem mudar a cadeia sem rever essa configuração. Token administrativo é exclusivo desta instalação. API usa usuário PostgreSQL sem superusuário; migrations usam credencial de manutenção separada.

## Operação

```sh
docker compose --env-file /opt/indice-politico/.env -f /opt/indice-politico/current/deploy/compose.yaml ps
docker compose --env-file /opt/indice-politico/.env -f /opt/indice-politico/current/deploy/compose.yaml logs --tail=80 api
sh /opt/indice-politico/current/deploy/backup.sh
```

Backup diário às 04:30 America/Sao_Paulo, retenção de 14 dias, contém banco, arquivos persistentes, ambiente secreto e referência da release. Diretório é privado; backups contêm dados e credenciais. Apenas diretórios com `COMPLETE` e hashes válidos são considerados concluídos. Backup no mesmo servidor protege contra erros operacionais, mas não contra perda total da VPS; cópia externa é uma melhoria posterior.

Antes de atualizar: gerar backup, empacotar versão exata e manifesto sem `.env`, construir sequencialmente sob limites, testar em banco `app_test` isolado, aplicar migrations com a credencial de manutenção, preservar grants do usuário `indice_app`, verificar contagens/rotas e só então promover release. Não usar o banco de produção para testes automatizados.

## Reversão inicial

Antes de haver novas escritas, é possível retirar apenas o site 9443 e parar somente o Compose `indice-politico`, preservando volume e backups. O banco local original permanece intacto e parado. Não usar `down -v`.

Depois de escritas na VPS, exportar o banco atual antes de voltar ao ambiente local. Nunca restaurar automaticamente o dump antigo sobre dados novos. Para recuperar um backup, validar SHA256SUMS, restaurar em banco separado com `pg_restore --no-owner --no-acl --exit-on-error`, conferir contagens e grants e só então trocar o destino da API.

O Docker local pode ficar desligado no uso diário. Desenvolvimento e alterações no código não são publicados automaticamente; uma nova release precisa passar pelo fluxo acima.
