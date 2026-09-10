/* ============================================================================
 * TABELA DE REFERENCIA EXCLUSIVA DA ABA OUTBACK - Prefixo de rota -> CD de
 * origem -> Transportadora -> Planilha
 * ----------------------------------------------------------------------------
 * Fonte: dados fornecidos pelo usuario, especificos das operacoes Outback
 * (rotas terminadas em letra, ex: "RJ746O", "RS214F", e lojas no formato
 * "MARCA-LOJA", ex: "OUT-PSH", "ABB-PSH").
 *
 * Completamente SEPARADA da tabela principal (data/prefixo_cd_transportadora.js)
 * de proposito: prefixos como "RJ", "SP" ou "RS" tem CD/transportadora
 * DIFERENTES entre as operacoes MCD e Outback (ex: "RJ" -> Martin Brower na
 * tabela principal, mas LOGMAM aqui) - usar a mesma tabela misturaria as duas
 * operacoes. So e usada pela aba "Outback" (ver js/app.js).
 *
 * Para atualizar: edite o array abaixo.
 * ==========================================================================*/
const PREFIXO_CD_TRANSPORTADORA_OUTBACK = [
  { prefixo: "NF", cd: "CDRJ", transportadora: "LOGMAM", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "RJ", cd: "CDRJ", transportadora: "LOGMAM", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "VP", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "SP", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "RS", cd: "CDRS", transportadora: "PRODELOG", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "NP", cd: "CDPR", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrOUTBACK_Sem" },
  { prefixo: "PN", cd: "CDPR", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrOUTBACK_Sem" },
];

if (typeof module !== 'undefined') {
  module.exports = { PREFIXO_CD_TRANSPORTADORA_OUTBACK };
}
