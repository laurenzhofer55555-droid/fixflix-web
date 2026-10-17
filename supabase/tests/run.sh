#!/usr/bin/env bash
# Applies ../schema.sql to a throwaway Postgres and attacks it twice: in SQL as
# the anon role (abuse.sql) and over HTTP through a real PostgREST, the API
# server Supabase runs (api_attack.py). Run it after changing schema.sql.
#
# Needs Docker and python3. Leaves nothing behind.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
net=fixflix-schema-test
pg=fixflix-schema-test-pg
api=fixflix-schema-test-api
port=3999

cleanup() {
  docker rm -f "$pg" "$api" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$net" >/dev/null
docker run -d --name "$pg" --network "$net" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null

# The image restarts Postgres once after initialising, so wait for two good answers.
for _ in 1 2; do
  until docker exec "$pg" psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done
  sleep 2
done

sql() { docker exec -i "$pg" psql -U postgres -q "$@"; }

# What a fresh Supabase project looks like to schema.sql: API roles that get
# every privilege on new objects by default — the script has to take them away.
sql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'test' noinherit;
grant anon to authenticator;
create database sqlsuite;
create database apisuite;
SQL

for db in sqlsuite apisuite; do
  sql -d "$db" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
grant usage on schema public to anon, authenticated;
SQL
  sql -d "$db" -v ON_ERROR_STOP=1 < "$here/../schema.sql" 2>&1 | grep -v '^NOTICE' || true
  # Second run must be harmless: people re-run scripts in the SQL editor.
  sql -d "$db" -v ON_ERROR_STOP=1 < "$here/../schema.sql" 2>&1 | grep -v '^NOTICE' || true
done

echo "### SQL suite (as the anon role)"
sql_out="$(sql -d sqlsuite -v ON_ERROR_STOP=0 < "$here/abuse.sql" 2>&1 | grep -vE '^$|^(NOTICE|DETAIL|drop cascades)' || true)"
echo "$sql_out" | grep -vE '^PASS' || true
sql_pass="$(echo "$sql_out" | grep -c '^PASS' || true)"
sql_fail="$(echo "$sql_out" | grep -vcE '^(PASS|==)' || true)"
echo "    $sql_pass passed, $sql_fail failed"

echo "### API suite (HTTP through PostgREST)"
docker run -d --name "$api" --network "$net" -p "127.0.0.1:$port:3000" \
  -e PGRST_DB_URI="postgres://authenticator:test@$pg:5432/apisuite" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon postgrest/postgrest >/dev/null
until curl -s -o /dev/null "http://127.0.0.1:$port/"; do sleep 1; done

api_status=0
python3 "$here/api_attack.py" "http://127.0.0.1:$port" || api_status=$?

[ "$sql_fail" -eq 0 ] && [ "$sql_pass" -gt 0 ] && [ "$api_status" -eq 0 ]
