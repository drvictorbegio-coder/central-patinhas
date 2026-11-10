-- =====================================================================
-- 0003: segurança (RLS + permissões) e tempo real
-- Regra geral: o navegador LÊ por meio das visões/tabelas (somente usuários
-- ativos) e GRAVA somente por meio das funções RPC acima. Configurações
-- podem ser gravadas diretamente, mas apenas por administradores (RLS + trigger).
-- =====================================================================

-- ---------- Permissões de tabela: começa fechando tudo
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER TABLE public.perfis             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_senha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratorios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_exame        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prazos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animais            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atendimentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internacoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retornos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico          ENABLE ROW LEVEL SECURITY;

-- ---------- Leitura: somente funcionários ativos
CREATE POLICY leitura_ativos ON public.perfis       FOR SELECT TO authenticated USING (public.is_ativo() OR id = auth.uid());
CREATE POLICY leitura_ativos ON public.laboratorios FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.tipos_exame  FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.prazos       FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.feriados     FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.configuracoes FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.tutores      FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.animais      FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.atendimentos FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.exames       FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.cobrancas    FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.internacoes  FOR SELECT TO authenticated USING (public.is_ativo());
CREATE POLICY leitura_ativos ON public.retornos     FOR SELECT TO authenticated USING (public.is_ativo());
-- Histórico: operacional para todos os ativos; eventos de acesso/usuários só para administradores.
CREATE POLICY leitura_ativos ON public.historico    FOR SELECT TO authenticated
  USING (public.is_ativo() AND (public.is_admin() OR entidade IS DISTINCT FROM 'usuario'));
CREATE POLICY leitura_admin  ON public.solicitacoes_senha FOR SELECT TO authenticated USING (public.is_admin());

-- ---------- Escrita direta: somente configurações, somente administradores
CREATE POLICY escrita_admin ON public.laboratorios  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.tipos_exame   FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.prazos        FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.feriados      FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY escrita_admin ON public.configuracoes FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.perfis, public.laboratorios, public.tipos_exame, public.prazos, public.feriados, public.configuracoes,
  public.tutores, public.animais, public.atendimentos, public.exames, public.cobrancas, public.internacoes, public.retornos,
  public.historico, public.solicitacoes_senha TO authenticated;
GRANT SELECT ON public.v_exames, public.v_retornos, public.v_internacoes TO authenticated;
GRANT INSERT, UPDATE ON public.laboratorios, public.tipos_exame, public.prazos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feriados TO authenticated;
GRANT UPDATE ON public.configuracoes TO authenticated;
GRANT USAGE ON SEQUENCE public.laboratorios_id_seq, public.tipos_exame_id_seq, public.prazos_id_seq TO authenticated;

-- ---------- Funções liberadas para o navegador
GRANT EXECUTE ON FUNCTION
  public.hoje(), public.eh_dia_util(date), public.soma_dias_uteis(date, int), public.proximo_dia_util(date),
  public.dias_uteis_entre(date, date), public.is_ativo(), public.is_admin(),
  public.salvar_tutor(jsonb), public.salvar_animal(jsonb), public.buscar_cadastros(text),
  public.criar_atendimento(jsonb), public.cadastrar_exames(jsonb),
  public.exame_receber(int), public.exame_desfazer_recebimento(int), public.exame_comunicar(int, text),
  public.exame_desfazer_comunicacao(int), public.exame_cobrar(int), public.exame_cancelar(int, text),
  public.exame_vincular(int, int), public.exame_corrigir(int, jsonb),
  public.retorno_criar(jsonb), public.retorno_alterar_previsao(int, date, int), public.retorno_acao(int, text, jsonb),
  public.internar(int, text), public.dar_alta(int, boolean, date, text),
  public.painel_contadores(), public.relatorio_gerencial(date, date),
  public.registrar_acesso(), public.confirmar_login(), public.ativar_minha_conta(),
  public.admin_criar_perfil(uuid, text, text, text), public.admin_alterar_usuario(uuid, jsonb), public.admin_registrar_link(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_redefinicao(text) TO anon, authenticated;

-- Funções criadas no futuro não ficam abertas por padrão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------- Tempo real: toda ação gera uma linha no histórico; as telas escutam essas inserções.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'historico') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.historico;
    END IF;
  END IF;
END $$;
