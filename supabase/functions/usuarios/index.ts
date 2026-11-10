// Gestão de Usuários e configuração inicial — Supabase Edge Function.
// Usa a chave de serviço que o Supabase injeta automaticamente (nunca sai do servidor).
// A permissão de administrador é conferida no BANCO pelas funções admin_* (chamadas com o token de quem pediu).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMINIO = "equipe.patinhasdeassis.local";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-origem",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const email = (login: string) => `${login.trim().toLowerCase()}@${DOMINIO}`;
const loginOk = (l: string) => /^[a-z0-9._-]{3,40}$/.test(l || "");
function senhaProblema(s: unknown) {
  if (typeof s !== "string" || s.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (s.length > 72) return "Senha muito longa.";
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return "A senha precisa conter letras e números.";
  return null;
}
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function randomSenha() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[^A-Za-z0-9]/g, "") + "a1";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(URL, SERVICE, opts);
  const origem = (req.headers.get("x-origem") || req.headers.get("origin") || "").replace(/\/$/, "");
  async function gerarLink(login: string) {
    const { data, error } = await sb.auth.admin.generateLink({ type: "recovery", email: email(login) });
    if (error) throw error;
    const t = data?.properties?.hashed_token;
    if (!t) throw new Error("O Supabase não retornou o link de acesso.");
    return `${origem}/#/senha?t=${encodeURIComponent(t)}&l=${encodeURIComponent(login)}`;
  }

  try {
    const { count } = await sb.from("perfis").select("id", { count: "exact", head: true });
    if (req.method === "GET") return json(200, { precisa_configurar: count === 0, setup_habilitado: true });
    const b = await req.json().catch(() => ({}));

    // ---------- Configuração inicial: primeiro administrador (código de uso único)
    if (b.acao === "setup") {
      if (count && count > 0) return json(403, { erro: "O sistema já foi configurado." });
      const { data: cfg } = await sb.from("setup_inicial").select("codigo_hash").eq("id", 1).maybeSingle();
      if (!cfg || cfg.codigo_hash !== await sha256(String(b.setup_token || "").trim())) return json(403, { erro: "Código de configuração inválido." });
      const nome = String(b.nome_completo || "").trim();
      const login = String(b.login || "").trim().toLowerCase();
      if (nome.length < 2) return json(400, { erro: "Informe o nome completo." });
      if (!loginOk(login)) return json(400, { erro: "Login: 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado." });
      const p = senhaProblema(b.senha); if (p) return json(400, { erro: p });
      const { data, error } = await sb.auth.admin.createUser({ email: email(login), password: b.senha, email_confirm: true, user_metadata: { nome_completo: nome, login } });
      if (error) return json(400, { erro: `Não foi possível criar o login: ${error.message}` });
      const id = data.user.id;
      const { error: e1 } = await sb.from("perfis").insert({ id, nome_completo: nome, login, perfil: "admin", situacao: "ativo" });
      if (e1) { await sb.auth.admin.deleteUser(id); return json(400, { erro: e1.message }); }
      await sb.from("historico").insert({ usuario_id: id, usuario_nome: nome, acao: "usuario_criado", entidade: "usuario", descricao: `Configuração inicial: primeiro administrador criado — ${nome} (${login})` });
      await sb.from("setup_inicial").update({ codigo_hash: "usado" }).eq("id", 1);
      return json(201, { ok: true });
    }

    // ---------- Demais ações: exigem administrador logado (conferido no banco)
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const usuario = createClient(URL, ANON, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: ehAdmin, error: eAdm } = await usuario.rpc("is_admin");
    if (eAdm) return json(401, { erro: "Sessão expirada. Entre novamente." });
    if (!ehAdmin) return json(403, { erro: "Acesso restrito aos administradores." });

    if (b.acao === "criar") {
      const nome = String(b.nome_completo || "").trim();
      const login = String(b.login || "").trim().toLowerCase();
      const perfil = b.perfil === "admin" ? "admin" : "recepcao";
      if (nome.length < 2) return json(400, { erro: "Informe o nome completo." });
      if (!loginOk(login)) return json(400, { erro: "Login: use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado (sem espaços nem acentos)." });
      const { data, error } = await sb.auth.admin.createUser({ email: email(login), password: randomSenha(), email_confirm: true, user_metadata: { nome_completo: nome, login } });
      if (error) {
        const dup = /already|registered|exists/i.test(error.message);
        return json(dup ? 409 : 400, { erro: dup ? "Este login já está em uso." : `Não foi possível criar o login: ${error.message}` });
      }
      const id = data.user.id;
      const { error: e1 } = await usuario.rpc("admin_criar_perfil", { p_id: id, p_nome: nome, p_login: login, p_perfil: perfil });
      if (e1) { await sb.auth.admin.deleteUser(id); return json(400, { erro: e1.message }); }
      return json(201, { id, link: await gerarLink(login) });
    }
    if (b.acao === "link") {
      const { data: p } = await usuario.from("perfis").select("login").eq("id", b.id).maybeSingle();
      if (!p) return json(404, { erro: "Usuário não encontrado." });
      const { error } = await usuario.rpc("admin_registrar_link", { p_id: b.id });
      if (error) return json(400, { erro: error.message });
      await sb.auth.admin.updateUserById(b.id, { ban_duration: "none" });
      return json(200, { link: await gerarLink(p.login) });
    }
    if (b.acao === "alterar") {
      const alt: Record<string, unknown> = {};
      for (const k of ["nome_completo", "perfil", "situacao"]) if (b[k] !== undefined) alt[k] = b[k];
      const { data, error } = await usuario.rpc("admin_alterar_usuario", { p_id: b.id, p: alt });
      if (error) return json(400, { erro: error.message });
      const bloquear = data.situacao === "bloqueado" || data.situacao === "inativo";
      const { error: e2 } = await sb.auth.admin.updateUserById(b.id, { ban_duration: bloquear ? "876000h" : "none" });
      if (e2) return json(500, { erro: `Situação salva, mas o bloqueio de login não foi confirmado: ${e2.message}` });
      return json(200, { ok: true, usuario: data });
    }
    return json(400, { erro: "Ação inválida." });
  } catch (e) {
    return json(500, { erro: (e as Error).message || "Erro inesperado." });
  }
});
