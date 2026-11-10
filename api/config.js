'use strict';
// Entrega ao navegador apenas os dados PÚBLICOS do Supabase (URL e chave anon/publishable).
const { URL, ANON, DOMINIO, json } = require('./_lib');

module.exports = (req, res) => {
  if (!URL || !ANON) {
    return json(res, 500, { erro: 'Configuração incompleta: defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente da Vercel.' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  json(res, 200, { supabaseUrl: URL, supabaseAnonKey: ANON, loginDomain: DOMINIO });
};
