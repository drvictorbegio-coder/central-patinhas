-- Cadastro em uma única tela: tutor (novo ou existente) → paciente (novo ou existente) →
-- atendimento com exames OU sem exames (com retorno programado). Tudo numa só transação:
-- se algo falhar, nada é gravado pela metade.
CREATE OR REPLACE FUNCTION public.registrar_atendimento_completo(p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u public.perfis := public._exigir_usuario();
  v_tutor int := nullif(p->'tutor'->>'id', '')::int;
  v_animal int := nullif(p->'animal'->>'id', '')::int;
  v_data date := coalesce(nullif(p->>'data', '')::date, public.hoje());
  v_com_exame boolean := coalesce((p->>'com_exame')::boolean, false);
  v_ret date := nullif(p->>'data_retorno', '')::date;
  v_res jsonb; v_at int;
BEGIN
  IF p->>'com_exame' IS NULL THEN RAISE EXCEPTION 'Informe se o atendimento tem exame ou não.'; END IF;

  -- Tutor
  IF v_tutor IS NULL THEN
    v_tutor := public.salvar_tutor((p->'tutor') - 'id' || jsonb_build_object('confirmar', coalesce((p->>'confirmar_tutor')::boolean, false)));
  ELSIF NOT EXISTS (SELECT 1 FROM public.tutores WHERE id = v_tutor) THEN
    RAISE EXCEPTION 'Tutor não encontrado.';
  END IF;

  -- Paciente
  IF v_animal IS NULL THEN
    v_animal := public.salvar_animal((p->'animal') - 'id' || jsonb_build_object('tutor_id', v_tutor,
      'confirmar', coalesce((p->>'confirmar_animal')::boolean, false)));
  ELSIF NOT EXISTS (SELECT 1 FROM public.animais WHERE id = v_animal AND tutor_id = v_tutor) THEN
    RAISE EXCEPTION 'O paciente selecionado não pertence a este tutor.';
  END IF;

  -- Atendimento
  IF v_com_exame THEN
    v_res := public.cadastrar_exames(jsonb_build_object(
      'animal_id', v_animal, 'data_realizacao', v_data, 'itens', p->'itens', 'descricao', p->>'descricao',
      'atendimento', 'auto', 'gerar_retorno', coalesce((p->>'gerar_retorno')::boolean, false),
      'data_retorno', v_ret, 'confirmar_duplicado', coalesce((p->>'confirmar_duplicado')::boolean, false)));
    v_at := (v_res->>'atendimento_id')::int;
  ELSE
    IF v_ret IS NULL THEN RAISE EXCEPTION 'Informe a data prevista do retorno.'; END IF;
    IF v_ret < v_data THEN RAISE EXCEPTION 'A data do retorno não pode ser anterior ao atendimento.'; END IF;
    v_at := public.criar_atendimento(jsonb_build_object(
      'animal_id', v_animal, 'data', v_data, 'descricao', p->>'descricao', 'gerar_retorno', true,
      'data_retorno', v_ret, 'confirmar', coalesce((p->>'confirmar_atendimento')::boolean, false)));
  END IF;

  RETURN jsonb_build_object('tutor_id', v_tutor, 'animal_id', v_animal, 'atendimento_id', v_at,
    'exames', coalesce(v_res->'exames', '[]'::jsonb), 'com_exame', v_com_exame);
END $$;
REVOKE EXECUTE ON FUNCTION public.registrar_atendimento_completo(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_atendimento_completo(jsonb) TO authenticated;
