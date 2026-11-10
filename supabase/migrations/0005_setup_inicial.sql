-- Código de uso único para criar o primeiro administrador (guardado só como hash; acessível apenas ao servidor).
-- Gere o hash de um código novo com: SELECT encode(sha256('SEU-CODIGO'::bytea), 'hex');
CREATE TABLE public.setup_inicial (id int PRIMARY KEY CHECK (id = 1), codigo_hash text NOT NULL);
ALTER TABLE public.setup_inicial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setup_inicial FROM anon, authenticated;
