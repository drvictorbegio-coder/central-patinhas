#!/bin/sh
# Recria o banco local "patinhas" para testes manuais
export PGHOST=/tmp/pgt PGPORT=54329 PGUSER=postgres
psql -q -c "drop database if exists patinhas with (force)" -c "create database patinhas"
psql -q -d patinhas -v ON_ERROR_STOP=1 -f "$(dirname "$0")/supabase_stub.sql" 2>/dev/null
for f in "$(dirname "$0")"/../supabase/migrations/*.sql; do psql -q -d patinhas -v ON_ERROR_STOP=1 -f "$f" || exit 1; done
