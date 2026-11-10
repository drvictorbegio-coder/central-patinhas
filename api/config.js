'use strict';
// Entrega ao navegador apenas os dados PÚBLICOS do Supabase (URL e chave publishable), vindos das variáveis da Vercel.
module.exports = (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!supabaseUrl || !supabaseAnonKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ erro: 'Configuração incompleta: defina SUPABASE_URL e SUPABASE_ANON_KEY na Vercel.' }));
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(JSON.stringify({ supabaseUrl, supabaseAnonKey, loginDomain: 'equipe.patinhasdeassis.local' }));
};
