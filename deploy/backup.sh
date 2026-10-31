#!/bin/sh
set -eu
umask 077
root=/opt/indice-politico
exec 9>"$root/backup.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$root/backups/$stamp"
mkdir -p "$destination"
docker compose --env-file "$root/.env" -f "$root/current/deploy/compose.yaml" exec -T db pg_dump -U indice -d indice --format=custom --no-owner --no-acl > "$destination/database.dump.partial"
mv "$destination/database.dump.partial" "$destination/database.dump"
tar -czf "$destination/files.tar.gz" -C "$root/data" output logs
cp "$root/.env" "$destination/environment.env"
readlink -f "$root/current" > "$destination/release.txt"
(cd "$destination" && sha256sum database.dump files.tar.gz environment.env release.txt > SHA256SUMS)
touch "$destination/COMPLETE"
# Retenção somente de backups completos deste projeto, após sucesso do novo backup.
find "$root/backups" -mindepth 2 -maxdepth 2 -name COMPLETE -mtime +14 -exec sh -c 'for marker do directory=${marker%/COMPLETE}; case "$directory" in /opt/indice-politico/backups/[0-9]*T*Z) rm -rf -- "$directory";; esac; done' sh {} +
echo "Backup concluído: $destination"
