/* ============================================================================
 * APP.JS - Interface e orquestracao
 * ----------------------------------------------------------------------------
 * Duas abas de processamento ("Processar PDF" e "Outback") + Configuracoes
 * (botao de engrenagem). As duas abas de processamento compartilham o mesmo
 * pipeline generico (ver createCtx/processarPdfs/gerarExcels abaixo), mas
 * cada uma usa sua PROPRIA tabela de referencia, resolucao de origem e fatia
 * de historico (ver js/core-logic.js) - nenhuma altera o comportamento da
 * outra. As duas aceitam selecionar varios PDFs de uma vez; os registros de
 * todos os arquivos sao consolidados num unico resultado/Excel.
 * ==========================================================================*/

const $ = (sel, root) => (root || document).querySelector(sel);
const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// Estado compartilhado pelas duas abas de processamento (o modelo de Excel e
// a lib do PDF.js sao os mesmos para as duas - ver Configuracoes).
const globalState = {
  pdfjsLib: null,
  modelFile: null // ArrayBuffer custom, se o usuario enviar um modelo proprio
};

/* ---------------------------------- Toasts ------------------------------- */
function showToast(message, type) {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type ? 'toast-' + type : ''}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 4200);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------------------------- pdf.js -------------------------------- */
function ensureLibsLoaded() {
  if (globalState.pdfjsLib) return Promise.resolve(globalState.pdfjsLib);
  return (async () => {
    // O especificador do import() e relativo a ESTE arquivo (js/app.js).
    const pdfjsLib = await import('../vendor/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
    globalState.pdfjsLib = pdfjsLib;
    return pdfjsLib;
  })();
}

/* ============================================================================
 * NAVEGACAO: Processar PDF <-> Outback <-> Configuracoes (engrenagem)
 * ==========================================================================*/
function initNav() {
  const pages = { processar: $('#pageProcessar'), outback: $('#pageOutback'), config: $('#pageConfig') };
  const tabProcessarBtn = $('#tabProcessarBtn');
  const tabOutbackBtn = $('#tabOutbackBtn');
  const btnSettings = $('#btnSettings');
  let lastContentTab = 'processar'; // para a engrenagem "voltar" para a aba certa

  function showPage(name) {
    Object.keys(pages).forEach(key => { pages[key].hidden = key !== name; });
    tabProcessarBtn.classList.toggle('active', name === 'processar');
    tabOutbackBtn.classList.toggle('active', name === 'outback');
    btnSettings.classList.toggle('active', name === 'config');
    btnSettings.title = name === 'config' ? 'Voltar' : 'Configurações';
    if (name !== 'config') lastContentTab = name;
  }

  tabProcessarBtn.addEventListener('click', () => showPage('processar'));
  tabOutbackBtn.addEventListener('click', () => showPage('outback'));
  btnSettings.addEventListener('click', () => showPage(pages.config.hidden ? 'config' : lastContentTab));
}

/* ============================================================================
 * CONTEXTO DE PROCESSAMENTO - um por aba (Processar PDF / Outback). Cada
 * contexto guarda suas proprias referencias de DOM e seu proprio estado, e
 * aponta para as funcoes de extracao/resolucao de origem corretas da aba
 * (ver js/core-logic.js). Isso permite reusar todo o pipeline abaixo
 * (dropzone, processamento, geracao) para as duas abas sem duplicar codigo
 * nem misturar dados de uma aba na outra.
 * ==========================================================================*/
function createCtx(cfg) {
  const s = cfg.idSuffix || '';
  return {
    idSuffix: s,
    extractFn: cfg.extractFn,
    extractOpts: cfg.extractOpts || {},
    resolveOrigemFn: cfg.resolveOrigemFn,
    resolveRegraCarregamentoFn: cfg.resolveRegraCarregamentoFn,
    arquivoTabelaReferencia: cfg.arquivoTabelaReferencia,
    historicoNegocio: cfg.historicoNegocio || null,
    origemFallbackStorageKey: cfg.origemFallbackStorageKey,
    dom: {
      dropZone: $('#dropZone' + s),
      pdfInput: $('#pdfInput' + s),
      fileList: $('#fileList' + s),
      btnProcessar: $('#btnProcessar' + s),
      progressSection: $('#progressSection' + s),
      progressBar: $('#progressBar' + s),
      progressStatus: $('#progressStatus' + s),
      progressDetail: $('#progressDetail' + s),
      summarySection: $('#summarySection' + s),
      sumPages: $('#sumPages' + s),
      sumRecords: $('#sumRecords' + s),
      sumValid: $('#sumValid' + s),
      sumInvalid: $('#sumInvalid' + s),
      sumWarnings: $('#sumWarnings' + s),
      sumAutoReturns: $('#sumAutoReturns' + s),
      issuesSection: $('#issuesSection' + s),
      issuesList: $('#issuesList' + s),
      autoReturnSection: $('#autoReturnSection' + s),
      autoReturnList: $('#autoReturnList' + s),
      genSection: $('#genSection' + s),
      btnGerar: $('#btnGerar' + s),
      genStatus: $('#genStatus' + s),
      downloadSection: $('#downloadSection' + s),
      downloadList: $('#downloadList' + s),
      downloadAllBtn: $('#downloadAllBtn' + s)
    },
    state: {
      pdfFiles: [], // File[] selecionados (multiplos)
      origemFallback: cfg.origemFallbackDefault,
      records: [], warnings: [], errors: [], autoReturns: [],
      excelFiles: [] // [{ fileName, blob, count }]
    }
  };
}

/* ============================================================================
 * DROPZONE / ARQUIVOS PDF (multiplos)
 * ==========================================================================*/
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function resetProcessingUI(ctx) {
  ctx.dom.summarySection.hidden = true;
  ctx.dom.issuesSection.hidden = true;
  ctx.dom.autoReturnSection.hidden = true;
  ctx.dom.genSection.hidden = true;
  ctx.dom.progressSection.hidden = true;
  ctx.dom.downloadSection.hidden = true;
  ctx.dom.genStatus.hidden = true;
  ctx.dom.btnGerar.disabled = true;
  ctx.state.records = []; ctx.state.warnings = []; ctx.state.errors = []; ctx.state.autoReturns = [];
  ctx.state.excelFiles = [];
}

function renderFileList(ctx) {
  const container = ctx.dom.fileList;
  container.innerHTML = '';
  ctx.state.pdfFiles.forEach((file, idx) => {
    const row = document.createElement('div');
    row.className = 'file-info';
    row.innerHTML = `
      <div class="file-info-icon">PDF</div>
      <div class="file-info-main">
        <div class="file-info-name">${escapeHtml(file.name)}</div>
        <div class="file-info-size">${formatBytes(file.size)}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon';
    btn.title = 'Remover arquivo';
    btn.textContent = '\u00d7';
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); removePdfFile(ctx, idx); });
    row.appendChild(btn);
    container.appendChild(row);
  });
  container.hidden = ctx.state.pdfFiles.length === 0;
  ctx.dom.btnProcessar.disabled = ctx.state.pdfFiles.length === 0;
}

function addPdfFiles(ctx, fileListRaw) {
  const files = Array.from(fileListRaw || []);
  const validos = [];
  files.forEach(f => {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showToast(`"${f.name}" não é um PDF e foi ignorado.`, 'error');
      return;
    }
    const jaSelecionado = ctx.state.pdfFiles.some(existente => existente.name === f.name && existente.size === f.size);
    if (jaSelecionado) {
      showToast(`"${f.name}" já está na lista.`, 'info');
      return;
    }
    validos.push(f);
  });
  if (!validos.length) return;
  ctx.state.pdfFiles.push(...validos);
  renderFileList(ctx);
  resetProcessingUI(ctx); // nova selecao invalida o resultado anterior
}

function removePdfFile(ctx, idx) {
  ctx.state.pdfFiles.splice(idx, 1);
  renderFileList(ctx);
  resetProcessingUI(ctx);
}

function initDropzone(ctx) {
  const zone = ctx.dom.dropZone;
  const input = ctx.dom.pdfInput;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addPdfFiles(ctx, input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (ev) => { ev.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (ev) => { ev.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', (ev) => { addPdfFiles(ctx, ev.dataTransfer.files); });
}

/* ============================================================================
 * RENDER: RESUMO / VALIDACAO / RETORNOS AUTOMATICOS
 * ==========================================================================*/
function renderSummary(ctx, norm, warnings, autoReturns, pagesCount) {
  const valid = norm.records.filter(r => r.valido).length;
  const invalid = norm.records.length - valid;
  ctx.dom.sumPages.textContent = pagesCount;
  ctx.dom.sumRecords.textContent = norm.records.length;
  ctx.dom.sumValid.textContent = valid;
  ctx.dom.sumInvalid.textContent = invalid;
  ctx.dom.sumWarnings.textContent = warnings.length;
  ctx.dom.sumAutoReturns.textContent = autoReturns.length;
  ctx.dom.summarySection.hidden = false;
}

const WARNING_LABELS = {
  prefixo_nao_cadastrado: { badge: 'ORIGEM', cls: 'issue-warning' },
  carregamento_ausente: { badge: 'CARREGAMENTO', cls: 'issue-info' },
  inconsistencia_caixas: { badge: 'CAIXAS', cls: 'issue-info' },
  duplicado: { badge: 'DUPLICADO', cls: 'issue-warning' },
  linha_incompleta: { badge: 'LINHA', cls: 'issue-warning' }
};

function renderIssues(ctx, errors, warnings, marcarArquivo) {
  const list = ctx.dom.issuesList;
  list.innerHTML = '';
  const items = [];

  errors.forEach(e => {
    items.push({ cls: 'issue-error', badge: 'ERRO', html: `Rota <strong>${escapeHtml(e.rota)}</strong> / Loja <strong>${escapeHtml(e.loja)}</strong> (pág. ${e.page}): ${escapeHtml(e.motivos.join('; '))}` });
  });
  warnings.forEach(w => {
    const label = WARNING_LABELS[w.type] || { badge: 'AVISO', cls: 'issue-warning' };
    const loc = w.rota ? `Rota <strong>${escapeHtml(w.rota)}</strong>${w.loja ? ` / Loja <strong>${escapeHtml(w.loja)}</strong>` : ''}: ` : '';
    const arquivoTag = (marcarArquivo && w.arquivo) ? `<em>[${escapeHtml(w.arquivo)}]</em> ` : '';
    items.push({ cls: label.cls, badge: label.badge, html: `${arquivoTag}${loc}${escapeHtml(w.detail)}` });
  });

  if (items.length === 0) {
    ctx.dom.issuesSection.hidden = true;
    return;
  }
  items.forEach(it => {
    const div = document.createElement('div');
    div.className = `issue ${it.cls}`;
    div.innerHTML = `<span class="issue-badge">${it.badge}</span><span>${it.html}</span>`;
    list.appendChild(div);
  });
  ctx.dom.issuesSection.hidden = false;
}

function renderAutoReturns(ctx, autoReturns) {
  const list = ctx.dom.autoReturnList;
  list.innerHTML = '';
  if (!autoReturns.length) { ctx.dom.autoReturnSection.hidden = true; return; }
  autoReturns.forEach(r => {
    const div = document.createElement('div');
    div.className = 'issue issue-info';
    div.innerHTML = `<span class="issue-badge">RETORNO</span><span>Rota <strong>${escapeHtml(r.rota)}</strong> → <strong>${escapeHtml(r.loja)}</strong>: ${escapeHtml(r._auto.motivo)}</span>`;
    list.appendChild(div);
  });
  ctx.dom.autoReturnSection.hidden = false;
}

/* ============================================================================
 * PIPELINE PRINCIPAL: PROCESSAR (1 ou mais PDFs, consolidados)
 * ==========================================================================*/
async function processarPdfs(ctx) {
  if (!ctx.state.pdfFiles.length) return;
  resetProcessingUI(ctx);
  ctx.dom.progressSection.hidden = false;
  ctx.dom.progressStatus.textContent = 'Carregando bibliotecas...';
  ctx.dom.progressBar.style.width = '2%';
  ctx.dom.progressBar.classList.remove('error');
  ctx.dom.btnProcessar.disabled = true;

  try {
    const pdfjsLib = await ensureLibsLoaded();
    const totalFiles = ctx.state.pdfFiles.length;
    const allRawRecords = [];
    const allRawWarnings = [];
    let totalPages = 0;

    // 1) extrai cada arquivo separadamente (cada um mantem seu proprio numero
    // de paginas/Faturamento), marcando cada registro/aviso com o arquivo de
    // origem para rastreabilidade.
    for (let fi = 0; fi < totalFiles; fi++) {
      const file = ctx.state.pdfFiles[fi];
      ctx.dom.progressStatus.textContent = totalFiles > 1 ? `Lendo arquivo ${fi + 1} de ${totalFiles}: ${file.name}` : 'Lendo arquivo...';
      const buf = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

      const raw = await ctx.extractFn(pdfDoc, ctx.extractOpts, ({ page, totalPages: tp, recordsSoFar }) => {
        const overallPct = (fi + page / tp) / totalFiles;
        ctx.dom.progressBar.style.width = (5 + Math.round(overallPct * 55)) + '%';
        ctx.dom.progressDetail.textContent = totalFiles > 1
          ? `Arquivo ${fi + 1}/${totalFiles} (${file.name}) — página ${page} de ${tp} — ${recordsSoFar} registro(s)`
          : `Página ${page} de ${tp} — ${recordsSoFar} registro(s) encontrados`;
      });

      raw.records.forEach(r => { r._sourceFile = file.name; });
      raw.warnings.forEach(w => { w.arquivo = file.name; });
      allRawRecords.push(...raw.records);
      allRawWarnings.push(...raw.warnings);
      totalPages += pdfDoc.numPages;
    }

    // 2) valida TODOS os arquivos juntos numa unica passada - isso tambem faz
    // a deteccao de duplicados (rota+loja+faturamento) considerar os varios
    // arquivos como um unico conjunto, nao cada um isoladamente.
    ctx.dom.progressStatus.textContent = 'Validando registros...';
    ctx.dom.progressBar.style.width = '65%';
    const norm = normalizeAndValidate({ records: allRawRecords, warnings: allRawWarnings }, {
      origemFallback: ctx.state.origemFallback,
      resolveOrigemFn: ctx.resolveOrigemFn,
      resolveRegraCarregamentoFn: ctx.resolveRegraCarregamentoFn,
      arquivoTabelaReferencia: ctx.arquivoTabelaReferencia
    });

    ctx.dom.progressStatus.textContent = 'Consultando histórico de retornos...';
    ctx.dom.progressBar.style.width = '78%';
    const historicoTodos = await CTDB.getAllHistorico();
    // cada aba so enxerga o historico marcado com o seu proprio "negocio"
    // (aba principal = sem marcacao; Outback = negocio:'outback') - evita
    // misturar padroes de retorno de uma operacao na previsao da outra.
    const historico = ctx.historicoNegocio
      ? historicoTodos.filter(h => h.negocio === ctx.historicoNegocio)
      : historicoTodos.filter(h => !h.negocio);
    const autoReturns = buildAutoReturnRecords(norm.records, historico, {});

    // aprendizado silencioso: alimenta o historico de carregamento por
    // arquivo de origem (cada PDF contribui seu proprio registro)
    const porArquivo = new Map();
    norm.records.forEach(r => {
      const arq = (r._raw && r._raw._sourceFile) || null;
      if (!porArquivo.has(arq)) porArquivo.set(arq, []);
      porArquivo.get(arq).push(r);
    });
    for (const [arquivo, recs] of porArquivo.entries()) {
      const novoHistorico = buildHistoricoFromPdfRecords(recs, { origemArquivo: arquivo, origemRegistro: 'pdf' });
      if (ctx.historicoNegocio) novoHistorico.forEach(h => { h.negocio = ctx.historicoNegocio; });
      await CTDB.addHistoricoBulk(novoHistorico);
    }

    ctx.state.records = norm.records;
    ctx.state.warnings = norm.warnings;
    ctx.state.errors = norm.errors;
    ctx.state.autoReturns = autoReturns;

    ctx.dom.progressBar.style.width = '100%';
    ctx.dom.progressStatus.textContent = 'Concluído.';
    ctx.dom.progressDetail.textContent = totalFiles > 1
      ? `${totalFiles} arquivo(s) — ${norm.records.length} registro(s) consolidados — ${autoReturns.length} retorno(s) automático(s)`
      : `${norm.records.length} registro(s) — ${autoReturns.length} retorno(s) automático(s)`;

    renderSummary(ctx, norm, norm.warnings, autoReturns, totalPages);
    renderIssues(ctx, norm.errors, norm.warnings, totalFiles > 1);
    renderAutoReturns(ctx, autoReturns);

    ctx.dom.genSection.hidden = false;
    ctx.dom.btnGerar.disabled = norm.records.filter(r => r.valido).length === 0;

    showToast(totalFiles > 1 ? `${totalFiles} PDFs processados com sucesso.` : 'PDF processado com sucesso.', 'success');
  } catch (err) {
    console.error(err);
    ctx.dom.progressBar.classList.add('error');
    ctx.dom.progressStatus.textContent = 'Erro ao processar o(s) PDF(s).';
    ctx.dom.progressDetail.textContent = err.message || String(err);
    showToast('Erro ao processar: ' + (err.message || err), 'error');
  } finally {
    ctx.dom.btnProcessar.disabled = false;
  }
}

/* ============================================================================
 * GERACAO DO EXCEL (uma planilha por grupo - ver buildPlanilhaFileGroups)
 * ==========================================================================*/
async function gerarExcels(ctx) {
  const validRecords = ctx.state.records.filter(r => r.valido);
  if (!validRecords.length) return;
  const allRecords = validRecords.concat(ctx.state.autoReturns);

  ctx.dom.btnGerar.disabled = true;
  const statusEl = ctx.dom.genStatus;
  statusEl.hidden = false;
  statusEl.className = 'gen-status';
  statusEl.textContent = 'Gerando arquivo(s)...';
  ctx.state.excelFiles = [];

  try {
    let modelBuffer = globalState.modelFile;
    if (!modelBuffer) {
      const resp = await fetch('./data/modelo-excel.xlsx');
      if (!resp.ok) throw new Error('Não foi possível carregar o modelo padrão (data/modelo-excel.xlsx). Sirva os arquivos por http(s) e verifique se a pasta "data" foi enviada.');
      modelBuffer = await resp.arrayBuffer();
    }

    const grupos = buildPlanilhaFileGroups(allRecords);
    for (const grupo of grupos) {
      const result = await buildExcelWorkbook(modelBuffer, grupo.records, {});
      const outBuffer = await result.workbook.xlsx.writeBuffer();
      const blob = new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      ctx.state.excelFiles.push({ fileName: grupo.fileName, blob, count: grupo.records.length });
    }

    // Arquivo consolidado: mesma logica/modelo de buildExcelWorkbook, mas com
    // TODOS os registros (de todos os grupos) numa unica planilha, gerado
    // junto dos demais arquivos - nao substitui nenhum dos arquivos por grupo.
    const semana = grupos.length ? grupos[0].semana : '';
    const consolidadoBase = ctx.idSuffix === 'Otb' ? 'Consolidado_Outback' : 'Consolidado';
    const consolidadoFileName = semana !== '' ? `${consolidadoBase}_Sem${semana}.xlsx` : `${consolidadoBase}.xlsx`;
    const resultConsolidado = await buildExcelWorkbook(modelBuffer, allRecords, {});
    const outBufferConsolidado = await resultConsolidado.workbook.xlsx.writeBuffer();
    const blobConsolidado = new Blob([outBufferConsolidado], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    ctx.state.excelFiles.push({ fileName: consolidadoFileName, blob: blobConsolidado, count: allRecords.length });

    statusEl.classList.add('ok');
    statusEl.textContent = grupos.length === 1
      ? `Excel gerado com sucesso (${allRecords.length} linha(s)) + arquivo consolidado.`
      : `${grupos.length} planilhas geradas com sucesso (${allRecords.length} linha(s) no total, semana ${grupos[0].semana}) + arquivo consolidado.`;

    renderDownloadList(ctx, ctx.state.excelFiles);
    ctx.dom.downloadSection.hidden = false;
    showToast(grupos.length === 1 ? 'Excel gerado com sucesso.' : `${grupos.length} planilhas geradas com sucesso.`, 'success');
  } catch (err) {
    console.error(err);
    statusEl.classList.add('error');
    statusEl.textContent = 'Erro ao gerar o Excel: ' + (err.message || err);
    showToast('Erro ao gerar o Excel.', 'error');
  } finally {
    ctx.dom.btnGerar.disabled = false;
  }
}

function renderDownloadList(ctx, files) {
  const list = ctx.dom.downloadList;
  list.innerHTML = '';
  files.forEach((f, idx) => {
    const row = document.createElement('div');
    row.className = 'download-item';
    row.innerHTML = `<div class="download-filename">${escapeHtml(f.fileName)} <span class="download-count">(${f.count} linha${f.count === 1 ? '' : 's'})</span></div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-success';
    btn.textContent = 'Baixar';
    btn.addEventListener('click', () => baixarExcelPorIndice(ctx, idx));
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function baixarExcelPorIndice(ctx, idx) {
  const f = ctx.state.excelFiles[idx];
  if (!f) return;
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function baixarTodosExcel(ctx) {
  ctx.state.excelFiles.forEach((_, idx) => baixarExcelPorIndice(ctx, idx));
}

/* ============================================================================
 * INSTANCIAS DOS CONTEXTOS - Processar PDF (principal) e Outback
 * ==========================================================================*/
const ctxProcessar = createCtx({
  idSuffix: '',
  extractFn: extractPdfRecords,
  extractOpts: {},
  resolveOrigemFn: resolveOrigemForRota,
  resolveRegraCarregamentoFn: resolveRegraCarregamento,
  arquivoTabelaReferencia: 'data/prefixo_cd_transportadora.js',
  historicoNegocio: null,
  origemFallbackDefault: 'NLOC',
  origemFallbackStorageKey: 'ct_origem_fallback'
});

const ctxOutback = createCtx({
  idSuffix: 'Otb',
  extractFn: extractPdfRecords,
  extractOpts: { lojaRegex: LOJA_REGEX_OUTBACK },
  resolveOrigemFn: resolveOrigemForRotaOutback,
  resolveRegraCarregamentoFn: () => null, // Outback nao usa a regra DTHCARREG por nomenclatura da aba principal
  arquivoTabelaReferencia: 'data/prefixo_cd_transportadora_outback.js',
  historicoNegocio: 'outback',
  origemFallbackDefault: 'NLOC',
  origemFallbackStorageKey: 'ct_origem_fallback_outback'
});

/* ============================================================================
 * CONFIGURACOES: modelo Excel, origem fallback (principal), tabelas de
 * referencia e regra de carregamento (DTHCARREG)
 * ==========================================================================*/
function initConfigPage() {
  $('#modelInput').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      globalState.modelFile = await file.arrayBuffer();
      $('#modelFileName').textContent = file.name;
      const statusEl = $('#modelStatus');
      statusEl.className = 'model-status ok';
      statusEl.textContent = 'Modelo customizado carregado — será usado na próxima geração.';
      showToast('Modelo de Excel customizado carregado.', 'success');
    } catch (err) {
      showToast('Erro ao ler o arquivo de modelo.', 'error');
    }
  });

  $('#resetModelBtn').addEventListener('click', () => {
    globalState.modelFile = null;
    $('#modelInput').value = '';
    $('#modelFileName').textContent = 'Nenhum (usando modelo padrão embutido)';
    $('#modelStatus').className = 'model-status';
    $('#modelStatus').textContent = '';
  });

  const fallbackInput = $('#origemFallback');
  let savedFallback = null;
  try { savedFallback = localStorage.getItem(ctxProcessar.origemFallbackStorageKey); } catch (e) {}
  if (savedFallback) { ctxProcessar.state.origemFallback = savedFallback; fallbackInput.value = savedFallback; }
  fallbackInput.addEventListener('change', () => {
    const v = fallbackInput.value.trim().toUpperCase() || 'NLOC';
    fallbackInput.value = v;
    ctxProcessar.state.origemFallback = v;
    try { localStorage.setItem(ctxProcessar.origemFallbackStorageKey, v); } catch (e) {}
  });

  renderPrefixRefTable();
  $('#prefixTableSearch').addEventListener('input', (ev) => renderPrefixRefTable(ev.target.value));

  renderRegraCarregamentoTable();
  $('#regraCarregTableSearch').addEventListener('input', (ev) => renderRegraCarregamentoTable(ev.target.value));
}

function renderPrefixRefTable(filter) {
  const tbody = $('#prefixRefTableBody');
  const f = (filter || '').trim().toUpperCase();
  const rows = PREFIXO_CD_TRANSPORTADORA
    .filter(e => !f || e.prefixo.includes(f) || e.cd.includes(f) || e.transportadora.includes(f) || e.planilha.toUpperCase().includes(f))
    .sort((a, b) => a.prefixo.localeCompare(b.prefixo));

  tbody.innerHTML = rows.map(e => `<tr><td>${escapeHtml(e.prefixo)}</td><td>${escapeHtml(e.cd)}</td><td>${escapeHtml(e.transportadora)}</td><td>${escapeHtml(e.planilha)}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">Nenhum resultado.</td></tr>`;
}

// Descreve, em texto legivel, a regra de DTHCARREG de uma entrada de
// REGRAS_CARREGAMENTO (ver data/regra_carregamento.js).
function describeRegraCarregamento(r) {
  if (r.origemCondicional) {
    return `Se origem = ${r.origemCondicional}: ${r.diasAntesEntrega} dia(s) antes da entrega, ${r.hora}. Caso contrário: segue preliminar do PDF.`;
  }
  if (r.seguePreliminar) return 'Segue preliminar do PDF (sem alteração)';
  return `${r.diasAntesEntrega} dia${r.diasAntesEntrega === 1 ? '' : 's'} antes da entrega, ${r.hora}`;
}

function renderRegraCarregamentoTable(filter) {
  const tbody = $('#regraCarregTableBody');
  const f = (filter || '').trim().toUpperCase();

  const rows = REGRAS_CARREGAMENTO.map(r => ({
    fat: r.cdFat,
    nomenclatura: r.origemCondicional ? `Qualquer (origem = ${r.origemCondicional})` : r.nomenclaturas.join(' / '),
    regra: describeRegraCarregamento(r)
  })).filter(row => !f || row.fat.toUpperCase().includes(f) || row.nomenclatura.toUpperCase().includes(f) || row.regra.toUpperCase().includes(f));

  tbody.innerHTML = rows.map(row => `<tr><td>FAT. ${escapeHtml(row.fat)}</td><td>${escapeHtml(row.nomenclatura)}</td><td>${escapeHtml(row.regra)}</td></tr>`).join('')
    || `<tr><td colspan="3" style="text-align:center;color:var(--text-dim);">Nenhum resultado.</td></tr>`;
}

/* ============================================================================
 * ABA OUTBACK: origem fallback propria + tabela de referencia propria
 * ==========================================================================*/
function initOutbackSettings() {
  const fallbackInput = $('#origemFallbackOtb');
  let saved = null;
  try { saved = localStorage.getItem(ctxOutback.origemFallbackStorageKey); } catch (e) {}
  if (saved) { ctxOutback.state.origemFallback = saved; fallbackInput.value = saved; }
  fallbackInput.addEventListener('change', () => {
    const v = fallbackInput.value.trim().toUpperCase() || 'NLOC';
    fallbackInput.value = v;
    ctxOutback.state.origemFallback = v;
    try { localStorage.setItem(ctxOutback.origemFallbackStorageKey, v); } catch (e) {}
  });

  renderPrefixRefTableOutback();
}

function renderPrefixRefTableOutback(filter) {
  const tbody = $('#prefixRefTableBodyOtb');
  const f = (filter || '').trim().toUpperCase();
  const rows = PREFIXO_CD_TRANSPORTADORA_OUTBACK
    .filter(e => !f || e.prefixo.includes(f) || e.cd.includes(f) || e.transportadora.includes(f) || e.planilha.toUpperCase().includes(f))
    .sort((a, b) => a.prefixo.localeCompare(b.prefixo));

  tbody.innerHTML = rows.map(e => `<tr><td>${escapeHtml(e.prefixo)}</td><td>${escapeHtml(e.cd)}</td><td>${escapeHtml(e.transportadora)}</td><td>${escapeHtml(e.planilha)}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">Nenhum resultado.</td></tr>`;
}

/* ============================================================================
 * INICIALIZACAO
 * ==========================================================================*/
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initDropzone(ctxProcessar);
  initDropzone(ctxOutback);
  initConfigPage();
  initOutbackSettings();

  ctxProcessar.dom.btnProcessar.addEventListener('click', () => processarPdfs(ctxProcessar));
  ctxProcessar.dom.btnGerar.addEventListener('click', () => gerarExcels(ctxProcessar));
  ctxProcessar.dom.downloadAllBtn.addEventListener('click', () => baixarTodosExcel(ctxProcessar));

  ctxOutback.dom.btnProcessar.addEventListener('click', () => processarPdfs(ctxOutback));
  ctxOutback.dom.btnGerar.addEventListener('click', () => gerarExcels(ctxOutback));
  ctxOutback.dom.downloadAllBtn.addEventListener('click', () => baixarTodosExcel(ctxOutback));

  // carga inicial do historico (uma unica vez) a partir de data/backup_data.js
  // (entra sem campo "negocio", entao so alimenta a aba Processar PDF)
  if (typeof backupData !== 'undefined' && backupData && backupData.historico) {
    CTDB.seedHistoricoIfEmpty(backupData.historico).catch(err => console.error('Erro ao semear historico:', err));
  }

  // pre-aquece o pdf.js em segundo plano assim que a pagina carrega
  ensureLibsLoaded().catch(() => {});
});
