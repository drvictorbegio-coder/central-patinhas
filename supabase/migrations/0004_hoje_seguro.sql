-- "app.hoje" (data simulada) só vale em conexões diretas de teste; nunca pelas requisições do site (authenticator).
CREATE OR REPLACE FUNCTION public.hoje() RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN session_user = 'authenticator' THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ELSE coalesce(nullif(current_setting('app.hoje', true), '')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) END
$$;
GRANT EXECUTE ON FUNCTION public.hoje() TO authenticated;
