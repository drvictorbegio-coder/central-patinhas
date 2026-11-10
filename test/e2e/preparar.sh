#!/bin/sh
# Recria o banco local e os três usuários de teste da interface
"$(dirname "$0")/../reset.sh" >/dev/null 2>&1
PGHOST=/tmp/pgt PGPORT=54329 PGUSER=postgres psql -q -d patinhas <<'SQL'
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','bruna@teste.local'),('22222222-2222-2222-2222-222222222222','nathaly@teste.local'),('33333333-3333-3333-3333-333333333333','juliana@teste.local');
INSERT INTO perfis (id, nome_completo, login, perfil, situacao) VALUES
 ('11111111-1111-1111-1111-111111111111','Bruna Gestora','bruna','admin','ativo'),
 ('22222222-2222-2222-2222-222222222222','Nathaly Souza','nathaly','recepcao','ativo'),
 ('33333333-3333-3333-3333-333333333333','Juliana Lima','juliana','recepcao','ativo');
SQL
pkill -SIGUSR1 -f "postgrest pgrst.conf" 2>/dev/null; sleep 1
