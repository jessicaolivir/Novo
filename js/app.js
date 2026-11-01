/* Sistema PDV: vendas, produtos, caixa, relatórios, configurações e backup.
 * Valores monetários são armazenados em centavos (inteiros) para evitar
 * erros de arredondamento. Quando executado como programa instalado
 * (Electron), `window.pdvDesktop` oferece backup em arquivo e pelo Gmail. */
(function () {
  'use strict';

  const STORAGE_KEY = 'pdv_db_v1';
  const desk = window.pdvDesktop || null;
  const DIA_MS = 24 * 60 * 60 * 1000;

  const FORMAS = {
    dinheiro: { nome: 'Dinheiro', icone: 'i-cash', cor: '#059669' },
    debito: { nome: 'Débito', icone: 'i-card', cor: '#0891b2' },
    credito: { nome: 'Crédito', icone: 'i-card', cor: '#7c3aed' },
    pix: { nome: 'PIX', icone: 'i-pix', cor: '#db2777' }
  };
  const TITULOS = {
    vendas: ['Vendas', 'Registre as vendas do balcão'],
    produtos: ['Produtos', 'Cadastro, preços e estoque'],
    caixa: ['Caixa', 'Abertura, sangria, suprimento e fechamento'],
    relatorios: ['Relatórios', 'Acompanhe o desempenho da loja'],
    config: ['Configurações', 'Dados da loja e backup']
  };
  const CORES_AVATAR = [
    ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#06b6d4'], ['#10b981', '#34d399'], ['#f59e0b', '#f97316'],
    ['#ec4899', '#f43f5e'], ['#8b5cf6', '#d946ef'], ['#14b8a6', '#0ea5e9'], ['#ef4444', '#f97316']
  ];

  // ---------- Utilidades ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const icon = (id, cls = '') => `<svg class="ic ${cls}"><use href="#${id}"/></svg>`;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = cents => brl.format((cents || 0) / 100);
  const fmtQtd = q => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtData = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const totalItem = i => Math.round(i.preco * i.qtd);
  const arred3 = n => Math.round(n * 1000) / 1000;

  /** Converte "1.234,56", "12,5" ou "12.50" em centavos. Retorna NaN se inválido. */
  function parseMoney(str) {
    if (typeof str === 'number') return Math.round(str * 100);
    let s = String(str || '').trim().replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  const moneyInput = cents => ((cents || 0) / 100).toFixed(2).replace('.', ',');
  const parseNum = v => Number(String(v ?? '').replace(',', '.'));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();
  const dateKey = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  function hash(s) {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  function avatar(p) {
    const [a, b] = CORES_AVATAR[hash(p.categoria || p.nome) % CORES_AVATAR.length];
    const ini = p.nome.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `<span class="avatar" style="background:linear-gradient(135deg,${a},${b})">${esc(ini)}</span>`;
  }

  // ---------- Banco de dados (localStorage) ----------
  function dbPadrao() {
    return {
      produtos: [],
      vendas: [],
      caixas: [],
      seq: { venda: 0, caixa: 0 },
      config: {
        nomeLoja: 'Minha Loja',
        cnpj: '',
        endereco: '',
        telefone: '',
        mensagemCupom: 'Obrigado pela preferência! Volte sempre.',
        estoqueMinimo: 5,
        bloquearSemEstoque: false,
        tema: 'claro',
        backup: { aoFechar: true, diario: true, ultimoEmail: null, ultimoLocal: null, ultimoErro: null }
      }
    };
  }

  function normalizar(data) {
    const base = dbPadrao();
    const cfg = { ...base.config, ...(data.config || {}) };
    cfg.backup = { ...base.config.backup, ...((data.config || {}).backup || {}) };
    return {
      ...base, ...data,
      seq: { ...base.seq, ...(data.seq || {}) },
      config: cfg
    };
  }

  function carregarDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizar(JSON.parse(raw)) : dbPadrao();
    } catch (e) {
      console.error(e);
      return dbPadrao();
    }
  }

  let db = carregarDB();

  function salvar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      toast('Não foi possível salvar os dados.', 'err');
    }
  }

  const caixaAberto = () => db.caixas.find(c => !c.fechamento) || null;
  const produtoPorId = id => db.produtos.find(p => p.id === id);
  const produtoPorCodigo = cod => db.produtos.find(p => p.codigo && p.codigo === cod);
  const minimoDe = p => p.estoqueMinimo ?? (Number(db.config.estoqueMinimo) || 0);

  // ---------- UI geral ----------
  function toast(msg, tipo = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + tipo;
    t.innerHTML = (tipo === 'ok' ? icon('i-check') : tipo === 'err' ? icon('i-x') : '') + `<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), tipo === 'err' ? 5000 : 3000);
  }

  let onModalClose = null;
  function abrirModal(titulo, html, onClose, largo = false) {
    $('#modalTitulo').textContent = titulo;
    $('#modalCorpo').innerHTML = html;
    $('#modalBox').classList.toggle('wide', largo);
    $('#modalBg').classList.remove('hidden');
    onModalClose = onClose || null;
    const first = $('#modalCorpo [autofocus]') || $('#modalCorpo input, #modalCorpo select');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
  }
  function fecharModal() {
    if ($('#modalBg').classList.contains('hidden')) return;
    $('#modalBg').classList.add('hidden');
    $('#modalCorpo').innerHTML = '';
    const cb = onModalClose;
    onModalClose = null;
    if (cb) cb();
  }
  const modalAberto = () => !$('#modalBg').classList.contains('hidden');

  function confirmar(titulo, msg, onOk, textoOk = 'Confirmar', classe = 'danger') {
    abrirModal(titulo, `
      <p>${esc(msg)}</p>
      <div class="modal-actions">
        <button class="btn" data-act="nao">Voltar</button>
        <button class="btn ${classe}" data-act="sim" autofocus>${esc(textoOk)}</button>
      </div>`);
    $('#modalCorpo [data-act=nao]').onclick = fecharModal;
    $('#modalCorpo [data-act=sim]').onclick = () => { fecharModal(); onOk(); };
  }

  let viewAtual = 'vendas';
  function irPara(view) {
    viewAtual = view;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $('#tituloView').textContent = TITULOS[view][0];
    $('#subtituloView').textContent = TITULOS[view][1];
    if (view === 'vendas') { renderTiles(); setTimeout(() => $('#inputBusca').focus(), 0); }
    if (view === 'produtos') renderProdutos();
    if (view === 'caixa') renderCaixa();
    if (view === 'relatorios') renderRelatorios();
    if (view === 'config') renderConfig();
  }

  function renderStatusCaixa() {
    const c = caixaAberto();
    $('#caixaStatus').innerHTML = c
      ? `<span class="dot on"></span><div>Caixa nº ${c.numero} aberto<br><small>desde ${fmtData(c.abertura)}</small></div>`
      : `<span class="dot off"></span><div>Caixa fechado<br><small>abra para vender</small></div>`;
    $('#brandName').textContent = db.config.nomeLoja || 'Minha Loja';
  }

  function aplicarTema() {
    const escuro = db.config.tema === 'escuro';
    document.documentElement.dataset.theme = escuro ? 'dark' : 'light';
    $('#btnTema').innerHTML = escuro
      ? `${icon('i-sun')}<span>Tema claro</span>`
      : `${icon('i-moon')}<span>Tema escuro</span>`;
  }

  function atualizarRelogio() {
    const d = new Date();
    $('#relogio').innerHTML = `<strong>${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}`;
  }

  // ---------- VENDA ----------
  let carrinho = [];
  let sugestoesAtuais = [];
  let sugSel = -1;
  let categoriaSel = '';
  let tipoDesconto = 'valor';
  let animarPrimeiro = false;

  const subtotal = () => carrinho.reduce((s, i) => s + totalItem(i), 0);

  function descontoAplicado(sub) {
    const raw = $('#inputDesconto').value.trim();
    if (!raw) return 0;
    if (tipoDesconto === 'perc') {
      const p = parseNum(raw);
      if (!Number.isFinite(p) || p <= 0) return 0;
      return Math.min(sub, Math.round(sub * Math.min(p, 100) / 100));
    }
    const v = parseMoney(raw);
    return Number.isFinite(v) && v > 0 ? Math.min(sub, v) : 0;
  }

  function renderCarrinho() {
    const box = $('#carrinho');
    if (!carrinho.length) {
      box.innerHTML = `<div class="cupom-vazio">${icon('i-cart')}<strong>Nenhum item</strong><span>Leia um código de barras ou toque em um produto ao lado.</span></div>`;
    } else {
      box.innerHTML = carrinho.map((i, idx) => `
        <div class="item ${idx === 0 && animarPrimeiro ? 'novo' : ''}">
          <div>
            <div class="nome">${esc(i.nome)}</div>
            <div class="unit">${fmt(i.preco)} / ${esc(i.unidade)}</div>
          </div>
          <div class="total">${fmt(totalItem(i))}</div>
          <div class="ctrl">
            <button class="qbtn" data-menos="${idx}" title="Diminuir">${icon('i-minus')}</button>
            <input class="qtd-edit" type="number" min="0.001" step="0.001" value="${i.qtd}" data-idx="${idx}" aria-label="Quantidade">
            <button class="qbtn" data-mais="${idx}" title="Aumentar">${icon('i-plus')}</button>
          </div>
          <button class="btn icon danger-text rm" data-rm="${idx}" title="Remover item">${icon('i-trash')}</button>
        </div>`).join('');
    }
    animarPrimeiro = false;
    const sub = subtotal();
    const desc = descontoAplicado(sub);
    const qtdItens = carrinho.reduce((s, i) => s + i.qtd, 0);
    $('#cupomInfo').textContent = `${carrinho.length} ${carrinho.length === 1 ? 'produto' : 'produtos'} · ${fmtQtd(qtdItens)} ${qtdItens === 1 ? 'unidade' : 'unidades'}`;
    $('#totSubtotal').textContent = fmt(sub);
    $('#linhaDesconto').classList.toggle('hidden', !desc);
    $('#totDesconto').textContent = '− ' + fmt(desc);
    $('#totTotal').textContent = fmt(sub - desc);
    $('#btnFinalizar').disabled = !carrinho.length;
  }

  const qtdNoCarrinho = id => carrinho.filter(i => i.produtoId === id).reduce((s, i) => s + i.qtd, 0);

  function adicionarAoCarrinho(produto, qtd) {
    if (!(qtd > 0)) { toast('Quantidade inválida.', 'err'); return false; }
    if (db.config.bloquearSemEstoque && qtdNoCarrinho(produto.id) + qtd > produto.estoque) {
      toast(`Estoque insuficiente de "${produto.nome}" (disponível: ${fmtQtd(produto.estoque)}).`, 'err');
      return false;
    }
    const existente = carrinho.find(i => i.produtoId === produto.id);
    if (existente) {
      existente.qtd = arred3(existente.qtd + qtd);
      carrinho.splice(carrinho.indexOf(existente), 1);
      carrinho.unshift(existente);
    } else {
      carrinho.unshift({
        produtoId: produto.id, codigo: produto.codigo, nome: produto.nome,
        unidade: produto.unidade || 'UN', preco: produto.preco, custo: produto.custo || 0, qtd
      });
    }
    animarPrimeiro = true;
    renderCarrinho();
    return true;
  }

  function alterarQtd(idx, nova) {
    const item = carrinho[idx];
    if (!item) return;
    if (!(nova > 0)) { carrinho.splice(idx, 1); renderCarrinho(); return; }
    const p = produtoPorId(item.produtoId);
    if (db.config.bloquearSemEstoque && p && nova > p.estoque) {
      toast(`Estoque insuficiente (disponível: ${fmtQtd(p.estoque)}).`, 'err');
    } else {
      item.qtd = arred3(nova);
    }
    renderCarrinho();
  }

  function lerEntrada() {
    let termo = $('#inputBusca').value.trim();
    let qtd = parseNum($('#inputQtd').value) || 1;
    const m = termo.match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/);
    if (m) { qtd = parseNum(m[1]); termo = m[2].trim(); }
    return { termo, qtd };
  }

  function filtrarProdutos(termo) {
    const t = termo.toLowerCase();
    return db.produtos.filter(p =>
      (p.codigo || '').toLowerCase().includes(t) || p.nome.toLowerCase().includes(t));
  }

  function renderSugestoes() {
    const { termo } = lerEntrada();
    sugestoesAtuais = termo ? filtrarProdutos(termo).slice(0, 10) : [];
    sugSel = sugestoesAtuais.length ? 0 : -1;
    const ul = $('#sugestoes');
    if (!sugestoesAtuais.length) { ul.classList.add('hidden'); return; }
    ul.innerHTML = sugestoesAtuais.map((p, i) => `
      <li data-i="${i}" class="${i === sugSel ? 'sel' : ''}">
        <span class="prod-cell">${avatar(p)}<span><strong>${esc(p.nome)}</strong><small>${esc(p.codigo || 'sem código')}</small></span></span>
        <span><strong>${fmt(p.preco)}</strong><br><small>estoque ${fmtQtd(p.estoque)}</small></span>
      </li>`).join('');
    ul.classList.remove('hidden');
  }
  function marcarSugestao() {
    $$('#sugestoes li').forEach((li, i) => li.classList.toggle('sel', i === sugSel));
    const sel = $('#sugestoes li.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function renderChips() {
    const cats = [...new Set(db.produtos.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (categoriaSel && !cats.includes(categoriaSel)) categoriaSel = '';
    $('#chipsCategorias').innerHTML = cats.length
      ? [['', 'Todos'], ...cats.map(c => [c, c])].map(([v, n]) =>
        `<button class="chip ${v === categoriaSel ? 'on' : ''}" data-cat="${esc(v)}">${esc(n)}</button>`).join('')
      : '';
  }

  function renderTiles() {
    renderChips();
    const { termo } = lerEntrada();
    let lista = termo ? filtrarProdutos(termo) : db.produtos.slice();
    if (categoriaSel) lista = lista.filter(p => p.categoria === categoriaSel);
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!db.produtos.length) {
      $('#tilesProdutos').innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('i-box', 'xl')}
        <p><strong>Nenhum produto cadastrado</strong></p>
        <div class="row-btns"><button class="btn primary" data-acao="novo">${icon('i-plus')}Cadastrar produto</button>
        <button class="btn" data-acao="exemplo">Usar produtos de exemplo</button></div></div>`;
      return;
    }
    $('#tilesProdutos').innerHTML = lista.map(p => {
      const est = p.estoque <= 0 ? 'err' : p.estoque <= minimoDe(p) ? 'warn' : 'ok';
      return `<button class="tile ${p.estoque <= 0 ? 'sem' : ''}" data-add="${p.id}" title="${esc(p.nome)}">
        ${avatar(p)}
        <span class="badge ${est} est">${fmtQtd(p.estoque)}</span>
        <span class="nome">${esc(p.nome)}</span>
        <span class="preco">${fmt(p.preco)}<small class="muted"> /${esc(p.unidade)}</small></span>
      </button>`;
    }).join('') || `<div class="empty" style="grid-column:1/-1">Nenhum produto encontrado.</div>`;
  }

  function limparEntrada() {
    $('#inputBusca').value = '';
    $('#inputQtd').value = 1;
    $('#sugestoes').classList.add('hidden');
    sugestoesAtuais = [];
    renderTiles();
    $('#inputBusca').focus();
  }

  function submeterItem(produtoEscolhido) {
    const { termo, qtd } = lerEntrada();
    if (!termo && !produtoEscolhido) return;
    let p = produtoEscolhido || produtoPorCodigo(termo);
    if (!p) {
      const lista = filtrarProdutos(termo);
      if (lista.length === 1) p = lista[0];
      else if (lista.length > 1 && sugSel >= 0 && sugestoesAtuais[sugSel]) p = sugestoesAtuais[sugSel];
    }
    if (!p) { toast(`Produto não encontrado: "${termo}".`, 'err'); return; }
    if (adicionarAoCarrinho(p, qtd)) limparEntrada();
  }

  function limparVenda() {
    carrinho = [];
    $('#inputDesconto').value = '';
    renderCarrinho();
  }

  function cancelarVendaAtual() {
    if (!carrinho.length) return;
    confirmar('Cancelar venda', 'Deseja descartar todos os itens da venda atual?', () => {
      limparVenda();
      $('#inputBusca').focus();
      toast('Venda cancelada.');
    }, 'Descartar itens');
  }

  // ---------- PAGAMENTO ----------
  function abrirPagamento() {
    if (!carrinho.length) { toast('Adicione itens antes de finalizar.', 'err'); return; }
    if (!caixaAberto()) {
      toast('Abra o caixa antes de registrar vendas.', 'err');
      irPara('caixa');
      return;
    }
    const sub = subtotal();
    const desc = descontoAplicado(sub);
    const total = sub - desc;
    const pagamentos = [];
    let forma = 'dinheiro';

    abrirModal('Pagamento', `
      <div class="pag-total"><span>Total da venda</span><strong>${fmt(total)}</strong></div>
      <div class="formas">
        ${Object.entries(FORMAS).map(([k, f], i) => `
          <button type="button" class="forma ${k === forma ? 'sel' : ''}" data-forma="${k}">
            ${icon(f.icone)}<span>${f.nome}</span><small>Alt+${i + 1}</small>
          </button>`).join('')}
      </div>
      <form class="pag-add" id="pgForm">
        <input id="pgValor" type="text" inputmode="decimal" autofocus aria-label="Valor recebido">
        <button class="btn primary" type="submit">${icon('i-plus')}Lançar</button>
      </form>
      <div class="pag-lista" id="pgLista"></div>
      <div class="pag-resumo">
        <div><span>Recebido</span><strong id="pgPago">R$ 0,00</strong></div>
        <div id="pgRestBox"><span id="pgRestLbl">Falta</span><strong id="pgRest">${fmt(total)}</strong></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="pgVoltar">Voltar</button>
        <button class="btn success" id="pgConfirmar" disabled>${icon('i-check')}Concluir venda</button>
      </div>`);

    const pago = () => pagamentos.reduce((s, p) => s + p.valor, 0);
    const restante = () => Math.max(0, total - pago());

    function atualizar() {
      const pg = pago();
      $('#pgPago').textContent = fmt(pg);
      const troco = pg > total;
      $('#pgRestBox').classList.toggle('troco', troco || pg === total);
      $('#pgRestLbl').textContent = troco ? 'Troco' : 'Falta';
      $('#pgRest').textContent = fmt(troco ? pg - total : total - pg);
      $('#pgLista').innerHTML = pagamentos.map((p, i) => `
        <div><span>${FORMAS[p.forma].nome}</span><span><strong>${fmt(p.valor)}</strong>
        <button class="btn icon danger-text" data-rmpg="${i}" title="Remover">${icon('i-x')}</button></span></div>`).join('');
      $('#pgConfirmar').disabled = pg < total;
      $('#pgValor').value = moneyInput(restante());
    }

    function escolher(k) {
      forma = k;
      $$('#modalCorpo [data-forma]').forEach(x => x.classList.toggle('sel', x.dataset.forma === k));
      $('#pgValor').focus(); $('#pgValor').select();
    }
    $$('#modalCorpo [data-forma]').forEach(b => b.onclick = () => escolher(b.dataset.forma));

    $('#pgForm').onsubmit = e => {
      e.preventDefault();
      const v = parseMoney($('#pgValor').value);
      if (!Number.isFinite(v) || v <= 0) {
        if (pago() >= total) { concluir(); return; }
        toast('Informe um valor válido.', 'err'); return;
      }
      const falta = restante();
      if (falta === 0) { concluir(); return; }
      if (forma !== 'dinheiro' && v > falta) {
        toast('Somente pagamentos em dinheiro podem gerar troco.', 'err'); return;
      }
      pagamentos.push({ forma, valor: v });
      atualizar();
      if (pago() >= total) $('#pgConfirmar').focus();
      else { $('#pgValor').focus(); $('#pgValor').select(); }
    };
    $('#pgLista').onclick = e => {
      const b = e.target.closest('[data-rmpg]');
      if (b) { pagamentos.splice(Number(b.dataset.rmpg), 1); atualizar(); }
    };
    $('#modalCorpo').onkeydown = e => {
      if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); escolher(Object.keys(FORMAS)[Number(e.key) - 1]); }
    };
    $('#pgVoltar').onclick = fecharModal;
    $('#pgConfirmar').onclick = concluir;

    function concluir() {
      if (pago() < total) return;
      const venda = registrarVenda(sub, desc, total, pagamentos.slice());
      fecharModal();
      posVenda(venda);
    }
    atualizar();
  }

  function registrarVenda(sub, desc, total, pagamentos) {
    const caixa = caixaAberto();
    const pago = pagamentos.reduce((s, p) => s + p.valor, 0);
    db.seq.venda += 1;
    const venda = {
      id: uid(), numero: db.seq.venda, data: nowISO(), caixaId: caixa.id,
      itens: carrinho.map(i => ({ ...i })),
      subtotal: sub, desconto: desc, total, pagamentos,
      troco: Math.max(0, pago - total), status: 'concluida'
    };
    venda.itens.forEach(i => {
      const p = produtoPorId(i.produtoId);
      if (p) p.estoque = arred3(p.estoque - i.qtd);
    });
    db.vendas.push(venda);
    salvar();
    limparVenda();
    renderTiles();
    return venda;
  }

  function posVenda(venda) {
    abrirModal('Venda concluída', `
      <div class="sucesso">
        <div class="circ">${icon('i-check')}</div>
        <p>Venda nº <strong>${venda.numero}</strong> registrada no valor de <strong>${fmt(venda.total)}</strong>.</p>
        ${venda.troco > 0 ? `<p class="muted">Troco a devolver</p><div class="troco-grande">${fmt(venda.troco)}</div>` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn" id="pvImprimir">${icon('i-printer')}Imprimir cupom</button>
        <button class="btn primary" id="pvNova" autofocus>Nova venda (Enter)</button>
      </div>`, () => $('#inputBusca').focus());
    $('#pvImprimir').onclick = () => imprimirCupom(venda);
    $('#pvNova').onclick = fecharModal;
  }

  // ---------- CUPOM ----------
  function imprimirCupom(venda) {
    const c = db.config;
    $('#cupom').innerHTML = `
      <div class="c big">${esc(c.nomeLoja)}</div>
      ${c.cnpj ? `<div class="c">CNPJ: ${esc(c.cnpj)}</div>` : ''}
      ${c.endereco ? `<div class="c">${esc(c.endereco)}</div>` : ''}
      ${c.telefone ? `<div class="c">Tel: ${esc(c.telefone)}</div>` : ''}
      <hr>
      <div class="c">CUPOM NÃO FISCAL</div>
      <div>Venda nº ${venda.numero} ${venda.status === 'cancelada' ? '(CANCELADA)' : ''}</div>
      <div>${fmtData(venda.data)}</div>
      <hr>
      <table>
        ${venda.itens.map(i => `
          <tr><td colspan="2">${esc(i.nome)}</td></tr>
          <tr><td>${fmtQtd(i.qtd)} ${esc(i.unidade)} x ${fmt(i.preco)}</td><td class="r">${fmt(totalItem(i))}</td></tr>`).join('')}
      </table>
      <hr>
      <table>
        <tr><td>Subtotal</td><td class="r">${fmt(venda.subtotal)}</td></tr>
        ${venda.desconto ? `<tr><td>Desconto</td><td class="r">-${fmt(venda.desconto)}</td></tr>` : ''}
        <tr class="big"><td>TOTAL</td><td class="r">${fmt(venda.total)}</td></tr>
        ${venda.pagamentos.map(p => `<tr><td>${FORMAS[p.forma].nome}</td><td class="r">${fmt(p.valor)}</td></tr>`).join('')}
        ${venda.troco ? `<tr><td>Troco</td><td class="r">${fmt(venda.troco)}</td></tr>` : ''}
      </table>
      <hr>
      <div class="c">${esc(c.mensagemCupom)}</div>`;
    window.print();
  }

  // ---------- PRODUTOS ----------
  function renderProdutos() {
    const t = $('#buscaProduto').value.trim().toLowerCase();
    const lista = db.produtos
      .filter(p => !t || [p.nome, p.codigo, p.categoria].some(x => (x || '').toLowerCase().includes(t)))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    $('#produtosBody').innerHTML = lista.map(p => {
      const margem = p.preco ? Math.round((p.preco - (p.custo || 0)) / p.preco * 100) : 0;
      const est = p.estoque <= 0 ? 'err' : p.estoque <= minimoDe(p) ? 'warn' : 'ok';
      return `<tr>
        <td><div class="prod-cell">${avatar(p)}<div><strong>${esc(p.nome)}</strong><small class="muted">${esc(p.unidade)}</small></div></div></td>
        <td class="muted">${esc(p.codigo) || '—'}</td>
        <td>${p.categoria ? `<span class="badge info">${esc(p.categoria)}</span>` : ''}</td>
        <td class="r muted">${fmt(p.custo)}</td>
        <td class="r"><strong>${fmt(p.preco)}</strong></td>
        <td class="r ${margem < 0 ? 'neg' : ''}">${p.custo ? margem + '%' : '—'}</td>
        <td class="r"><span class="badge ${est}">${fmtQtd(p.estoque)}</span></td>
        <td class="acoes">
          <button class="btn icon" data-estoque="${p.id}" title="Movimentar estoque">${icon('i-layers')}</button>
          <button class="btn icon" data-edit="${p.id}" title="Editar">${icon('i-edit')}</button>
          <button class="btn icon danger-text" data-del="${p.id}" title="Excluir">${icon('i-trash')}</button>
        </td>
      </tr>`;
    }).join('');
    $('#produtosVazio').classList.toggle('hidden', lista.length > 0);
  }

  function formProduto(p) {
    const novo = !p;
    p = p || { codigo: '', nome: '', categoria: '', custo: 0, preco: 0, estoque: 0, unidade: 'UN', estoqueMinimo: null };
    abrirModal(novo ? 'Novo produto' : 'Editar produto', `
      <form id="fProd" class="form-grid">
        <div class="field span2"><label>Nome do produto *</label><input name="nome" value="${esc(p.nome)}" required autofocus></div>
        <div class="field"><label>Código de barras</label><input name="codigo" value="${esc(p.codigo)}" placeholder="Leia com o leitor"></div>
        <div class="field"><label>Categoria</label><input name="categoria" value="${esc(p.categoria)}" list="listaCategorias"></div>
        <div class="field"><label>Preço de custo (R$)</label><input name="custo" value="${moneyInput(p.custo)}" inputmode="decimal"></div>
        <div class="field"><label>Preço de venda (R$) *</label><input name="preco" value="${moneyInput(p.preco)}" inputmode="decimal" required></div>
        <div class="field"><label>${novo ? 'Estoque inicial' : 'Estoque atual'}</label><input name="estoque" type="number" step="0.001" value="${p.estoque}"></div>
        <div class="field"><label>Unidade</label>
          <select name="unidade">${['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'M'].map(u =>
            `<option ${u === p.unidade ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field span2"><label>Estoque mínimo (vazio usa o padrão da loja)</label><input name="estoqueMinimo" type="number" min="0" step="1" value="${p.estoqueMinimo ?? ''}"></div>
        <datalist id="listaCategorias">${[...new Set(db.produtos.map(x => x.categoria).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="fpCancelar">Cancelar</button>
          <button type="submit" class="btn primary">${icon('i-check')}Salvar produto</button>
        </div>
      </form>`);
    $('#fpCancelar').onclick = fecharModal;
    // Evita que a leitura do código de barras (que envia Enter) submeta o formulário.
    $('#fProd [name=codigo]').onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#fProd [name=categoria]').focus(); }
    };
    $('#fProd').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const codigo = String(f.get('codigo')).trim();
      const nome = String(f.get('nome')).trim();
      const preco = parseMoney(f.get('preco'));
      const custo = parseMoney(f.get('custo'));
      const estoque = parseNum(f.get('estoque')) || 0;
      const minRaw = String(f.get('estoqueMinimo')).trim();
      if (!nome) return toast('Informe o nome do produto.', 'err');
      if (!Number.isFinite(preco) || preco <= 0) return toast('Preço de venda inválido.', 'err');
      if (!Number.isFinite(custo) || custo < 0) return toast('Preço de custo inválido.', 'err');
      if (codigo) {
        const dup = produtoPorCodigo(codigo);
        if (dup && (novo || dup.id !== p.id)) return toast('Já existe um produto com esse código.', 'err');
      }
      const dados = {
        codigo, nome, preco, custo, estoque,
        categoria: String(f.get('categoria')).trim(),
        unidade: f.get('unidade'),
        estoqueMinimo: minRaw === '' ? null : Number(minRaw)
      };
      if (novo) db.produtos.push({ id: uid(), ...dados });
      else Object.assign(produtoPorId(p.id), dados);
      salvar();
      fecharModal();
      renderProdutos();
      toast('Produto salvo.', 'ok');
    };
  }

  function ajustarEstoque(p) {
    abrirModal(`Estoque: ${p.nome}`, `
      <p>Estoque atual: <strong>${fmtQtd(p.estoque)} ${esc(p.unidade)}</strong></p>
      <form id="fEst" class="form-grid">
        <div class="field"><label>Operação</label>
          <select name="op"><option value="entrada">Entrada (compra)</option><option value="saida">Saída (perda ou uso)</option><option value="ajuste">Corrigir para a quantidade</option></select></div>
        <div class="field"><label>Quantidade</label><input name="qtd" type="number" step="0.001" min="0" required autofocus></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="feCancelar">Cancelar</button>
          <button class="btn primary" type="submit">${icon('i-check')}Aplicar</button>
        </div>
      </form>`);
    $('#feCancelar').onclick = fecharModal;
    $('#fEst').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const q = parseNum(f.get('qtd'));
      if (!(q >= 0)) return toast('Quantidade inválida.', 'err');
      const op = f.get('op');
      if (op === 'entrada') p.estoque += q;
      else if (op === 'saida') p.estoque -= q;
      else p.estoque = q;
      p.estoque = arred3(p.estoque);
      salvar();
      fecharModal();
      renderProdutos();
      toast('Estoque atualizado.', 'ok');
    };
  }

  // ---------- CAIXA ----------
  function resumoCaixa(c) {
    const vendas = db.vendas.filter(v => v.caixaId === c.id && v.status === 'concluida');
    const porForma = Object.fromEntries(Object.keys(FORMAS).map(k => [k, 0]));
    vendas.forEach(v => {
      v.pagamentos.forEach(p => { porForma[p.forma] += p.valor; });
      porForma.dinheiro -= v.troco;
    });
    const soma = tipo => c.movimentos.filter(m => m.tipo === tipo).reduce((s, m) => s + m.valor, 0);
    const sangrias = soma('sangria');
    const suprimentos = soma('suprimento');
    const totalVendas = vendas.reduce((s, v) => s + v.total, 0);
    const esperadoDinheiro = c.valorInicial + porForma.dinheiro + suprimentos - sangrias;
    return { vendas, porForma, sangrias, suprimentos, totalVendas, esperadoDinheiro };
  }

  function barList(valores) {
    const max = Math.max(1, ...Object.values(valores));
    return `<div class="bar-list">${Object.entries(FORMAS).map(([k, f]) => `
      <div class="bar-row">
        <div class="top"><span>${f.nome}</span><strong>${fmt(valores[k])}</strong></div>
        <div class="track"><div class="fill" style="width:${Math.max(0, valores[k]) / max * 100}%;background:${f.cor}"></div></div>
      </div>`).join('')}</div>`;
  }

  function renderCaixa() {
    const c = caixaAberto();
    const painel = $('#caixaPainel');
    if (!c) {
      painel.innerHTML = `
        <div class="card">
          <div class="caixa-abrir">
            <div class="circ">${icon('i-lock')}</div>
            <h2>O caixa está fechado</h2>
            <p class="muted">Informe quanto há em dinheiro na gaveta (fundo de troco) para começar as vendas.</p>
            <form id="fAbrir">
              <input name="valor" value="0,00" inputmode="decimal" aria-label="Fundo de troco" autofocus>
              <button class="btn success" type="submit">${icon('i-unlock')}Abrir caixa</button>
            </form>
          </div>
        </div>`;
      $('#fAbrir').onsubmit = e => {
        e.preventDefault();
        const v = parseMoney(new FormData(e.target).get('valor'));
        if (!Number.isFinite(v) || v < 0) return toast('Valor inválido.', 'err');
        db.seq.caixa += 1;
        db.caixas.push({ id: uid(), numero: db.seq.caixa, abertura: nowISO(), fechamento: null, valorInicial: v, movimentos: [], valorContado: null });
        salvar();
        renderCaixa();
        renderStatusCaixa();
        toast('Caixa aberto. Boas vendas!', 'ok');
      };
    } else {
      const r = resumoCaixa(c);
      painel.innerHTML = `
        <div class="card">
          <div class="caixa-hero">
            <div>
              <h2>Caixa nº ${c.numero} <span class="badge ok">aberto</span></h2>
              <span class="muted">Aberto em ${fmtData(c.abertura)}</span>
            </div>
            <div class="row-btns">
              <button class="btn" id="btnSuprimento">${icon('i-arrow-down')}Suprimento</button>
              <button class="btn" id="btnSangria">${icon('i-arrow-up')}Sangria</button>
              <button class="btn danger" id="btnFecharCaixa">${icon('i-lock')}Fechar caixa</button>
            </div>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi plain"><span>Fundo inicial</span><strong>${fmt(c.valorInicial)}</strong></div>
          <div class="kpi plain"><span>Vendas (${r.vendas.length})</span><strong>${fmt(r.totalVendas)}</strong></div>
          <div class="kpi plain sm"><span>Suprimentos / Sangrias</span><strong>${fmt(r.suprimentos)} / ${fmt(r.sangrias)}</strong></div>
          <div class="kpi k4"><span>Dinheiro na gaveta</span><strong>${fmt(r.esperadoDinheiro)}</strong></div>
        </div>
        <div class="grid-2">
          <div class="card"><div class="card-title">Recebido por forma de pagamento</div>${barList(r.porForma)}</div>
          <div class="card">
            <div class="card-title">Movimentações</div>
            ${c.movimentos.length ? `<div class="mov-list">${c.movimentos.slice().reverse().map(m => `
              <div class="linha"><span>${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}<br><small class="muted">${fmtData(m.data)}${m.motivo ? ' · ' + esc(m.motivo) : ''}</small></span>
              <strong class="${m.tipo === 'sangria' ? 'neg' : 'pos'}">${m.tipo === 'sangria' ? '−' : '+'} ${fmt(m.valor)}</strong></div>`).join('')}</div>`
              : '<p class="muted">Nenhuma sangria ou suprimento neste caixa.</p>'}
          </div>
        </div>`;
      $('#btnSuprimento').onclick = () => movimentoCaixa(c, 'suprimento');
      $('#btnSangria').onclick = () => movimentoCaixa(c, 'sangria');
      $('#btnFecharCaixa').onclick = () => fecharCaixa(c);
    }

    $('#caixasBody').innerHTML = db.caixas.slice().reverse().map(cx => {
      const r = resumoCaixa(cx);
      const dif = cx.valorContado == null ? null : cx.valorContado - r.esperadoDinheiro;
      return `<tr>
        <td><strong>${cx.numero}</strong></td>
        <td>${fmtData(cx.abertura)}</td>
        <td>${cx.fechamento ? fmtData(cx.fechamento) : '<span class="badge ok">aberto</span>'}</td>
        <td class="r">${fmt(cx.valorInicial)}</td>
        <td class="r">${fmt(r.totalVendas)}</td>
        <td class="r">${fmt(r.esperadoDinheiro)}</td>
        <td class="r">${cx.valorContado == null ? '' : fmt(cx.valorContado)}</td>
        <td class="r">${dif == null ? '' : `<span class="badge ${dif < 0 ? 'err' : dif > 0 ? 'warn' : 'ok'}">${fmt(dif)}</span>`}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">Nenhum caixa registrado ainda.</td></tr>';
  }

  function movimentoCaixa(c, tipo) {
    abrirModal(tipo === 'sangria' ? 'Sangria (retirada de dinheiro)' : 'Suprimento (reforço de troco)', `
      <form id="fMov" class="form-grid">
        <div class="field"><label>Valor (R$)</label><input name="valor" inputmode="decimal" required autofocus></div>
        <div class="field"><label>Motivo</label><input name="motivo" placeholder="Opcional"></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="fmCancelar">Cancelar</button>
          <button class="btn primary" type="submit">${icon('i-check')}Confirmar</button>
        </div>
      </form>`);
    $('#fmCancelar').onclick = fecharModal;
    $('#fMov').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = parseMoney(f.get('valor'));
      if (!Number.isFinite(v) || v <= 0) return toast('Valor inválido.', 'err');
      if (tipo === 'sangria' && v > resumoCaixa(c).esperadoDinheiro) {
        return toast('A sangria é maior que o dinheiro disponível no caixa.', 'err');
      }
      c.movimentos.push({ tipo, valor: v, motivo: String(f.get('motivo')).trim(), data: nowISO() });
      salvar();
      fecharModal();
      renderCaixa();
      toast('Movimentação registrada.', 'ok');
    };
  }

  function fecharCaixa(c) {
    if (carrinho.length) return toast('Finalize ou cancele a venda em andamento antes de fechar o caixa.', 'err');
    const r = resumoCaixa(c);
    abrirModal(`Fechar caixa nº ${c.numero}`, `
      <div class="pag-resumo">
        <div><span>Vendas no caixa</span><strong>${fmt(r.totalVendas)}</strong></div>
        <div class="troco"><span>Dinheiro esperado</span><strong>${fmt(r.esperadoDinheiro)}</strong></div>
      </div>
      <form id="fFechar" class="form-grid">
        <div class="field span2"><label>Quanto você contou em dinheiro na gaveta? (R$)</label><input name="contado" inputmode="decimal" value="${moneyInput(r.esperadoDinheiro)}" required autofocus></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="ffCancelar">Cancelar</button>
          <button class="btn danger" type="submit">${icon('i-lock')}Fechar caixa</button>
        </div>
      </form>`);
    $('#ffCancelar').onclick = fecharModal;
    $('#fFechar').onsubmit = e => {
      e.preventDefault();
      const v = parseMoney(new FormData(e.target).get('contado'));
      if (!Number.isFinite(v) || v < 0) return toast('Valor inválido.', 'err');
      c.valorContado = v;
      c.fechamento = nowISO();
      salvar();
      fecharModal();
      renderCaixa();
      renderStatusCaixa();
      const dif = v - r.esperadoDinheiro;
      toast(dif === 0 ? 'Caixa fechado sem diferenças.' : `Caixa fechado com diferença de ${fmt(dif)}.`, dif === 0 ? 'ok' : 'err');
      fazerBackup('fechamento');
    };
  }

  // ---------- RELATÓRIOS ----------
  function definirPeriodo(p) {
    const hoje = new Date();
    let de = new Date(hoje);
    if (p === '7') de.setDate(hoje.getDate() - 6);
    else if (p === '30') de.setDate(hoje.getDate() - 29);
    else if (p === 'mes') de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    $('#relDe').value = dateKey(de);
    $('#relAte').value = dateKey(hoje);
    $$('#periodoSeg button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
    renderRelatorios();
  }

  function renderGrafico(vendas, de, ate) {
    const dias = [];
    const d = new Date(de + 'T12:00:00');
    const fim = new Date(ate + 'T12:00:00');
    while (d <= fim && dias.length < 62) { dias.push(dateKey(d)); d.setDate(d.getDate() + 1); }
    const tot = Object.fromEntries(dias.map(k => [k, 0]));
    vendas.forEach(v => { const k = dateKey(v.data); if (k in tot) tot[k] += v.total; });
    const max = Math.max(1, ...Object.values(tot));
    const mostrarRotulo = i => dias.length <= 16 || i % Math.ceil(dias.length / 12) === 0;
    $('#grafico').innerHTML = dias.map((k, i) => {
      const [, m, dd] = k.split('-');
      return `<div class="barra"><div style="height:${tot[k] / max * 100}%" data-v="${fmt(tot[k])}"></div>
        <small>${mostrarRotulo(i) ? `${dd}/${m}` : '&nbsp;'}</small></div>`;
    }).join('');
  }

  function renderRelatorios() {
    if (!$('#relDe').value) { $('#relDe').value = dateKey(new Date()); $('#relAte').value = dateKey(new Date()); }
    let de = $('#relDe').value, ate = $('#relAte').value;
    if (de > ate) [de, ate] = [ate, de];
    const doPeriodo = db.vendas.filter(v => { const k = dateKey(v.data); return k >= de && k <= ate; });
    const concl = doPeriodo.filter(v => v.status === 'concluida');

    const fat = concl.reduce((s, v) => s + v.total, 0);
    const custo = concl.reduce((s, v) => s + v.itens.reduce((a, i) => a + Math.round((i.custo || 0) * i.qtd), 0), 0);
    $('#kpiFat').textContent = fmt(fat);
    $('#kpiQtd').textContent = concl.length;
    $('#kpiTicket').textContent = fmt(concl.length ? Math.round(fat / concl.length) : 0);
    $('#kpiLucro').textContent = fmt(fat - custo);

    renderGrafico(concl, de, ate);

    const porForma = Object.fromEntries(Object.keys(FORMAS).map(k => [k, 0]));
    concl.forEach(v => { v.pagamentos.forEach(p => porForma[p.forma] += p.valor); porForma.dinheiro -= v.troco; });
    $('#relPagamentos').innerHTML = barList(porForma);

    const top = {};
    concl.forEach(v => v.itens.forEach(i => {
      const t = top[i.produtoId] || (top[i.produtoId] = { nome: i.nome, unidade: i.unidade, qtd: 0, total: 0 });
      t.qtd += i.qtd;
      t.total += totalItem(i);
    }));
    const topList = Object.values(top).sort((a, b) => b.total - a.total).slice(0, 8);
    $('#relTop').innerHTML = topList.length
      ? topList.map((t, i) => `<tr><td><span class="badge info">${i + 1}</span> ${esc(t.nome)}</td><td class="r">${fmtQtd(t.qtd)} ${esc(t.unidade)}</td><td class="r"><strong>${fmt(t.total)}</strong></td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">Sem vendas no período.</td></tr>';

    $('#relVendas').innerHTML = doPeriodo.slice().reverse().map(v => `
      <tr class="${v.status === 'cancelada' ? 'cancelada' : ''}">
        <td><strong>${v.numero}</strong></td>
        <td>${fmtData(v.data)}</td>
        <td class="r">${v.itens.length}</td>
        <td>${[...new Set(v.pagamentos.map(p => FORMAS[p.forma].nome))].join(', ')}</td>
        <td class="r valor"><strong>${fmt(v.total)}</strong></td>
        <td><span class="badge ${v.status === 'cancelada' ? 'err' : 'ok'}">${v.status === 'cancelada' ? 'cancelada' : 'concluída'}</span></td>
        <td class="acoes">
          <button class="btn icon" data-ver="${v.id}" title="Ver detalhes">${icon('i-eye')}</button>
          <button class="btn icon" data-print="${v.id}" title="Imprimir cupom">${icon('i-printer')}</button>
          ${v.status === 'concluida' ? `<button class="btn icon danger-text" data-cancel="${v.id}" title="Cancelar venda">${icon('i-x')}</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma venda no período.</td></tr>';

    const baixos = db.produtos.filter(p => p.estoque <= minimoDe(p)).sort((a, b) => a.estoque - b.estoque);
    $('#relEstoque').innerHTML = baixos.length
      ? baixos.map(p => `<tr><td class="muted">${esc(p.codigo) || '—'}</td><td>${esc(p.nome)}</td><td class="r"><span class="badge ${p.estoque <= 0 ? 'err' : 'warn'}">${fmtQtd(p.estoque)}</span></td><td class="r">${fmtQtd(minimoDe(p))}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Nenhum produto com estoque baixo.</td></tr>';
  }

  function verVenda(v) {
    abrirModal(`Venda nº ${v.numero}`, `
      <p class="muted">${fmtData(v.data)} · <span class="badge ${v.status === 'cancelada' ? 'err' : 'ok'}">${v.status === 'cancelada' ? 'cancelada' : 'concluída'}</span></p>
      <div class="card flush">
        <table class="table">
          <thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Unit.</th><th class="r">Total</th></tr></thead>
          <tbody>${v.itens.map(i => `<tr><td>${esc(i.nome)}</td><td class="r">${fmtQtd(i.qtd)}</td><td class="r">${fmt(i.preco)}</td><td class="r">${fmt(totalItem(i))}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="mov-list">
        <div class="linha"><span>Subtotal</span><span>${fmt(v.subtotal)}</span></div>
        <div class="linha"><span>Desconto</span><span>${fmt(v.desconto)}</span></div>
        <div class="linha"><strong>Total</strong><strong>${fmt(v.total)}</strong></div>
        ${v.pagamentos.map(p => `<div class="linha"><span>${FORMAS[p.forma].nome}</span><span>${fmt(p.valor)}</span></div>`).join('')}
        <div class="linha"><span>Troco</span><span>${fmt(v.troco)}</span></div>
      </div>
      ${v.motivoCancelamento ? `<p class="aviso">Motivo do cancelamento: ${esc(v.motivoCancelamento)}</p>` : ''}`, null, true);
  }

  function cancelarVendaRegistrada(v) {
    const cx = db.caixas.find(c => c.id === v.caixaId);
    if (!cx || cx.fechamento) return toast('Só é possível cancelar vendas do caixa que está aberto.', 'err');
    abrirModal(`Cancelar venda nº ${v.numero}`, `
      <p>Os itens voltarão ao estoque e o valor de <strong>${fmt(v.total)}</strong> será retirado do caixa.</p>
      <form id="fCanc" class="form-grid">
        <div class="field span2"><label>Motivo *</label><input name="motivo" required autofocus></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="fcVoltar">Voltar</button>
          <button class="btn danger" type="submit">Cancelar venda</button>
        </div>
      </form>`);
    $('#fcVoltar').onclick = fecharModal;
    $('#fCanc').onsubmit = e => {
      e.preventDefault();
      const motivo = String(new FormData(e.target).get('motivo')).trim();
      if (!motivo) return toast('Informe o motivo.', 'err');
      v.status = 'cancelada';
      v.motivoCancelamento = motivo;
      v.canceladaEm = nowISO();
      v.itens.forEach(i => {
        const p = produtoPorId(i.produtoId);
        if (p) p.estoque = arred3(p.estoque + i.qtd);
      });
      salvar();
      fecharModal();
      renderRelatorios();
      toast('Venda cancelada e estoque restaurado.', 'ok');
    };
  }

  // ---------- BACKUP ----------
  let gmail = { configurado: false };
  let backupEmAndamento = false;

  function nomeBackup() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    return `backup-pdv-${dateKey(d)}-${hh}.json`;
  }

  function resumoParaEmail(motivo) {
    const hoje = dateKey(new Date());
    const vendasHoje = db.vendas.filter(v => v.status === 'concluida' && dateKey(v.data) === hoje);
    const fatHoje = vendasHoje.reduce((s, v) => s + v.total, 0);
    const motivos = { fechamento: 'fechamento do caixa', diario: 'backup diário automático', manual: 'envio manual', teste: 'teste de configuração' };
    return [
      `Backup do sistema PDV da loja ${db.config.nomeLoja}.`,
      `Motivo: ${motivos[motivo] || motivo}.`,
      `Data: ${new Date().toLocaleString('pt-BR')}.`,
      '',
      `Vendas de hoje: ${vendasHoje.length} (${fmt(fatHoje)}).`,
      `Produtos cadastrados: ${db.produtos.length}.`,
      `Total de vendas registradas: ${db.vendas.length}.`,
      '',
      'Para restaurar, abra o PDV, vá em Configurações e clique em "Restaurar backup", escolhendo o arquivo anexo.'
    ].join('\n');
  }

  /** Salva backup em arquivo no computador e, se configurado, envia pelo Gmail. */
  async function fazerBackup(motivo) {
    if (!desk || backupEmAndamento) return;
    backupEmAndamento = true;
    const cfg = db.config.backup;
    const nome = nomeBackup();
    const conteudo = JSON.stringify(db);
    try {
      const local = await desk.salvarBackupLocal({ nomeArquivo: nome, conteudo });
      if (local.ok) cfg.ultimoLocal = nowISO();

      const enviar = gmail.configurado && (
        motivo === 'manual' || motivo === 'teste' ||
        (motivo === 'fechamento' && cfg.aoFechar) ||
        (motivo === 'diario' && cfg.diario));
      if (enviar) {
        const r = await desk.gmailEnviar({
          nomeArquivo: nome,
          conteudo,
          assunto: `Backup PDV ${db.config.nomeLoja} ${new Date().toLocaleDateString('pt-BR')}`,
          texto: resumoParaEmail(motivo)
        });
        if (r.ok) {
          cfg.ultimoEmail = nowISO();
          cfg.ultimoErro = null;
          if (motivo !== 'diario') toast('Backup enviado para o Gmail.', 'ok');
        } else {
          cfg.ultimoErro = `${new Date().toLocaleString('pt-BR')}: ${r.erro}`;
          toast(`Falha ao enviar backup: ${r.erro}`, 'err');
        }
      }
      salvar();
    } catch (e) {
      toast('Erro ao fazer backup: ' + e.message, 'err');
    } finally {
      backupEmAndamento = false;
      if (viewAtual === 'config') renderStatusBackup();
    }
  }

  function verificarBackupDiario() {
    if (!desk) return;
    const cfg = db.config.backup;
    const vencido = iso => !iso || Date.now() - new Date(iso).getTime() >= DIA_MS;
    const precisaEmail = gmail.configurado && cfg.diario && vencido(cfg.ultimoEmail);
    if (precisaEmail || vencido(cfg.ultimoLocal)) fazerBackup('diario');
  }

  function renderStatusBackup() {
    const cfg = db.config.backup;
    const linhas = [];
    if (gmail.configurado) linhas.push(`${icon('i-check')} Conectado como <strong>${esc(gmail.email)}</strong>, enviando para <strong>${esc(gmail.destino || gmail.email)}</strong>.`);
    linhas.push(`Último backup por e-mail: <strong>${cfg.ultimoEmail ? fmtData(cfg.ultimoEmail) : 'nunca'}</strong>`);
    linhas.push(`Último backup em arquivo neste computador: <strong>${cfg.ultimoLocal ? fmtData(cfg.ultimoLocal) : 'nunca'}</strong>`);
    if (cfg.ultimoErro) linhas.push(`<span class="neg">Último erro: ${esc(cfg.ultimoErro)}</span>`);
    $('#statusBackup').innerHTML = linhas.map(l => `<span>${l}</span>`).join('');
    $('#btnEnviarAgora').disabled = !gmail.configurado;
    $('#btnRemoverGmail').classList.toggle('hidden', !gmail.configurado);
  }

  function ajudaSenhaApp() {
    abrirModal('Como criar a senha de app do Google', `
      <ol class="passos">
        <li>Entre na conta Google da loja e ative a <strong>Verificação em duas etapas</strong>. Sem ela o Google não oferece senha de app.</li>
        <li>Abra a página <strong>Senhas de app</strong> da conta Google pelo botão abaixo.</li>
        <li>Digite um nome, por exemplo <strong>PDV</strong>, e clique em <strong>Criar</strong>.</li>
        <li>Copie a senha de 16 letras que aparecer e cole no campo "Senha de app" do PDV.</li>
      </ol>
      <p class="aviso">A senha de app só permite enviar e-mails. Ela não dá acesso à sua senha principal e pode ser revogada a qualquer momento na mesma página. Contas Gmail de empresas (Google Workspace) podem ter esse recurso bloqueado pelo administrador.</p>
      <div class="modal-actions">
        <button class="btn" id="ajSeg">Abrir verificação em duas etapas</button>
        <button class="btn primary" id="ajApp" autofocus>Abrir senhas de app</button>
      </div>`, null, true);
    const abrir = url => desk ? desk.abrirLink(url) : window.open(url, '_blank', 'noopener');
    $('#ajSeg').onclick = () => abrir('https://myaccount.google.com/signinoptions/twosv');
    $('#ajApp').onclick = () => abrir('https://myaccount.google.com/apppasswords');
  }

  // ---------- CONFIGURAÇÕES ----------
  async function renderConfig() {
    const f = $('#formConfig');
    Object.entries(db.config).forEach(([k, v]) => {
      const el = f.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    $('#gmailIndisponivel').classList.toggle('hidden', !!desk);
    $('#formGmail').classList.toggle('hidden', !desk);
    $('#btnAbrirPasta').classList.toggle('hidden', !desk);
    if (desk) {
      $('#infoBackupLocal').textContent = 'Os dados ficam salvos neste computador. O programa também guarda uma cópia automática por dia na pasta de backups.';
      gmail = await desk.gmailStatus();
      const g = $('#formGmail').elements;
      g.email.value = gmail.email || '';
      g.destino.value = gmail.destino || '';
      g.senha.value = '';
      g.senha.placeholder = gmail.configurado ? 'Senha salva (deixe vazio para manter)' : 'xxxx xxxx xxxx xxxx';
      g.aoFechar.checked = !!db.config.backup.aoFechar;
      g.diario.checked = !!db.config.backup.diario;
      renderStatusBackup();
    }
  }

  function produtosExemplo() {
    const ex = [
      ['7891000100103', 'Leite Integral 1L', 'Laticínios', 389, 549, 48, 'UN'],
      ['7891000200100', 'Iogurte Morango 170g', 'Laticínios', 189, 329, 24, 'UN'],
      ['7891910000197', 'Açúcar Refinado 1kg', 'Mercearia', 349, 529, 30, 'UN'],
      ['7896005800018', 'Café Torrado e Moído 500g', 'Mercearia', 1290, 1899, 25, 'UN'],
      ['7896004000021', 'Arroz Branco 5kg', 'Mercearia', 1890, 2799, 20, 'UN'],
      ['7896102500012', 'Feijão Carioca 1kg', 'Mercearia', 549, 849, 3, 'UN'],
      ['7891008121216', 'Biscoito Recheado 140g', 'Mercearia', 199, 349, 35, 'UN'],
      ['7891149103102', 'Refrigerante Cola 2L', 'Bebidas', 659, 999, 40, 'UN'],
      ['7894900011517', 'Água Mineral 500ml', 'Bebidas', 99, 250, 72, 'UN'],
      ['2000000000015', 'Pão Francês', 'Padaria', 900, 1599, 15, 'KG'],
      ['2000000000022', 'Bolo de Fubá (fatia)', 'Padaria', 250, 600, 12, 'UN'],
      ['7891024134702', 'Sabonete 90g', 'Higiene', 129, 249, 60, 'UN'],
      ['7896036090244', 'Detergente 500ml', 'Limpeza', 179, 299, 0, 'UN']
    ];
    let add = 0;
    ex.forEach(([codigo, nome, categoria, custo, preco, estoque, unidade]) => {
      if (produtoPorCodigo(codigo)) return;
      db.produtos.push({ id: uid(), codigo, nome, categoria, custo, preco, estoque, unidade, estoqueMinimo: null });
      add++;
    });
    salvar();
    return add;
  }

  function carregarExemplo() {
    const n = produtosExemplo();
    toast(n ? `${n} produtos de exemplo adicionados.` : 'Os produtos de exemplo já existem.', 'ok');
    if (viewAtual === 'vendas') renderTiles();
  }

  function exportar() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nomeBackup();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importar(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.produtos) || !Array.isArray(data.vendas) || !Array.isArray(data.caixas)) {
          throw new Error('estrutura');
        }
        confirmar('Restaurar backup',
          `O arquivo tem ${data.produtos.length} produtos e ${data.vendas.length} vendas. Os dados atuais serão substituídos. Continuar?`, () => {
            db = normalizar(data);
            salvar();
            carrinho = [];
            renderTudo();
            toast('Backup restaurado.', 'ok');
          }, 'Restaurar');
      } catch (e) {
        toast('Arquivo de backup inválido.', 'err');
      }
    };
    reader.readAsText(file);
  }

  function renderTudo() {
    aplicarTema();
    renderStatusCaixa();
    renderCarrinho();
    irPara(viewAtual);
  }

  // ---------- Eventos ----------
  function bind() {
    $$('.nav-btn').forEach(b => b.onclick = () => irPara(b.dataset.view));
    $('#btnTema').onclick = () => {
      db.config.tema = db.config.tema === 'escuro' ? 'claro' : 'escuro';
      salvar();
      aplicarTema();
    };

    // Venda
    $('#formAddItem').onsubmit = e => { e.preventDefault(); submeterItem(); };
    $('#inputBusca').addEventListener('input', () => { renderSugestoes(); renderTiles(); });
    $('#inputBusca').addEventListener('keydown', e => {
      const ul = $('#sugestoes');
      if (ul.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sugSel = Math.min(sugSel + 1, sugestoesAtuais.length - 1); marcarSugestao(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sugSel = Math.max(sugSel - 1, 0); marcarSugestao(); }
      else if (e.key === 'Escape') { e.stopPropagation(); ul.classList.add('hidden'); }
    });
    $('#inputBusca').addEventListener('blur', () => setTimeout(() => $('#sugestoes').classList.add('hidden'), 150));
    $('#sugestoes').addEventListener('mousedown', e => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      submeterItem(sugestoesAtuais[Number(li.dataset.i)]);
    });
    $('#tilesProdutos').addEventListener('click', e => {
      const t = e.target.closest('[data-add]');
      if (t) {
        const qtd = parseNum($('#inputQtd').value) || 1;
        if (adicionarAoCarrinho(produtoPorId(t.dataset.add), qtd)) { $('#inputQtd').value = 1; }
        return;
      }
      const a = e.target.closest('[data-acao]');
      if (a && a.dataset.acao === 'novo') { irPara('produtos'); formProduto(null); }
      if (a && a.dataset.acao === 'exemplo') carregarExemplo();
    });
    $('#chipsCategorias').addEventListener('click', e => {
      const c = e.target.closest('[data-cat]');
      if (c) { categoriaSel = c.dataset.cat; renderTiles(); }
    });
    $('#carrinho').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.rm !== undefined) { carrinho.splice(Number(d.rm), 1); renderCarrinho(); }
      if (d.mais !== undefined) alterarQtd(Number(d.mais), carrinho[Number(d.mais)].qtd + 1);
      if (d.menos !== undefined) alterarQtd(Number(d.menos), carrinho[Number(d.menos)].qtd - 1);
    });
    $('#carrinho').addEventListener('change', e => {
      if (e.target.classList.contains('qtd-edit')) alterarQtd(Number(e.target.dataset.idx), parseNum(e.target.value));
    });
    $('#inputDesconto').addEventListener('input', renderCarrinho);
    $('#tipoDescontoSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-tipo]');
      if (!b) return;
      tipoDesconto = b.dataset.tipo;
      $$('#tipoDescontoSeg button').forEach(x => x.classList.toggle('on', x === b));
      renderCarrinho();
    });
    $('#btnFinalizar').onclick = abrirPagamento;
    $('#btnCancelarVenda').onclick = cancelarVendaAtual;

    // Produtos
    $('#btnNovoProduto').onclick = () => formProduto(null);
    $('#buscaProduto').addEventListener('input', renderProdutos);
    $('#produtosBody').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.edit) formProduto(produtoPorId(d.edit));
      if (d.estoque) ajustarEstoque(produtoPorId(d.estoque));
      if (d.del) {
        const p = produtoPorId(d.del);
        confirmar('Excluir produto', `Excluir "${p.nome}"? As vendas já registradas serão mantidas.`, () => {
          db.produtos = db.produtos.filter(x => x.id !== p.id);
          carrinho = carrinho.filter(i => i.produtoId !== p.id);
          salvar(); renderProdutos(); renderCarrinho();
          toast('Produto excluído.');
        }, 'Excluir');
      }
    });

    // Relatórios
    $('#relDe').addEventListener('change', () => { $$('#periodoSeg button').forEach(b => b.classList.remove('on')); renderRelatorios(); });
    $('#relAte').addEventListener('change', () => { $$('#periodoSeg button').forEach(b => b.classList.remove('on')); renderRelatorios(); });
    $('#periodoSeg').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) definirPeriodo(b.dataset.p); });
    $('#relVendas').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      const v = db.vendas.find(x => x.id === (d.ver || d.print || d.cancel));
      if (!v) return;
      if (d.ver) verVenda(v);
      if (d.print) imprimirCupom(v);
      if (d.cancel) cancelarVendaRegistrada(v);
    });

    // Configurações
    $('#formConfig').onsubmit = e => {
      e.preventDefault();
      const f = e.target.elements;
      Object.assign(db.config, {
        nomeLoja: f.nomeLoja.value.trim() || 'Minha Loja',
        cnpj: f.cnpj.value.trim(),
        endereco: f.endereco.value.trim(),
        telefone: f.telefone.value.trim(),
        mensagemCupom: f.mensagemCupom.value.trim(),
        estoqueMinimo: Number(f.estoqueMinimo.value) || 0,
        bloquearSemEstoque: f.bloquearSemEstoque.checked
      });
      salvar();
      renderStatusCaixa();
      toast('Configurações salvas.', 'ok');
    };

    $('#linkAjudaSenha').onclick = e => { e.preventDefault(); ajudaSenhaApp(); };
    $('#formGmail').onsubmit = async e => {
      e.preventDefault();
      const g = e.target.elements;
      const btn = e.submitter || $('#formGmail button[type=submit]');
      db.config.backup.aoFechar = g.aoFechar.checked;
      db.config.backup.diario = g.diario.checked;
      salvar();
      const email = g.email.value.trim();
      const senha = g.senha.value.replace(/\s+/g, '');
      if (!gmail.configurado && senha.length !== 16) {
        return toast('A senha de app do Google tem 16 letras. Clique em "Como criar?" para ver o passo a passo.', 'err');
      }
      if (senha && senha.length !== 16) return toast('A senha de app do Google tem 16 letras.', 'err');
      btn.disabled = true;
      btn.innerHTML = 'Testando conexão...';
      try {
        const r = await desk.gmailSalvar({ email, senha, destino: g.destino.value.trim() });
        if (!r.ok) { toast(r.erro, 'err'); return; }
        gmail = await desk.gmailStatus();
        await fazerBackup('teste');
        renderConfig();
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${icon('i-check')}Salvar e enviar teste`;
      }
    };
    ['aoFechar', 'diario'].forEach(n => $('#formGmail').elements[n].addEventListener('change', e => {
      db.config.backup[n] = e.target.checked;
      salvar();
    }));
    $('#btnEnviarAgora').onclick = async () => {
      const b = $('#btnEnviarAgora');
      b.disabled = true;
      b.textContent = 'Enviando...';
      await fazerBackup('manual');
      b.innerHTML = `${icon('i-mail')}Enviar backup agora`;
      b.disabled = !gmail.configurado;
    };
    $('#btnRemoverGmail').onclick = () => confirmar('Desconectar Gmail',
      'O programa deixará de enviar backups por e-mail e a senha de app salva será apagada deste computador.', async () => {
        await desk.gmailRemover();
        gmail = await desk.gmailStatus();
        renderConfig();
        toast('Gmail desconectado.');
      }, 'Desconectar');

    $('#btnExportar').onclick = exportar;
    $('#btnAbrirPasta').onclick = () => desk && desk.abrirPastaBackups();
    $('#inputImportar').onchange = e => { if (e.target.files[0]) importar(e.target.files[0]); e.target.value = ''; };
    $('#btnExemplo').onclick = carregarExemplo;
    $('#btnLimpar').onclick = () => confirmar('Apagar todos os dados',
      'Todos os produtos, vendas e caixas serão apagados definitivamente. Exporte um backup antes, se necessário.', () => {
        const tema = db.config.tema;
        db = dbPadrao();
        db.config.tema = tema;
        salvar();
        carrinho = [];
        renderTudo();
        toast('Dados apagados.');
      }, 'Apagar tudo');

    // Modal
    $('#modalFechar').onclick = fecharModal;
    $('#modalBg').addEventListener('mousedown', e => { if (e.target.id === 'modalBg') fecharModal(); });

    // Atalhos de teclado
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalAberto()) { e.preventDefault(); fecharModal(); return; }
      if (modalAberto()) return;
      if (e.key === 'F1') { e.preventDefault(); irPara('vendas'); }
      else if (e.key === 'F2') { e.preventDefault(); irPara('vendas'); $('#inputBusca').focus(); }
      else if (e.key === 'F4') { e.preventDefault(); if (viewAtual === 'vendas') abrirPagamento(); }
      else if (e.key === 'F8') { e.preventDefault(); if (viewAtual === 'vendas') cancelarVendaAtual(); }
    });
  }

  // ---------- Início ----------
  bind();
  renderTudo();
  atualizarRelogio();
  setInterval(atualizarRelogio, 15000);

  if (desk) {
    desk.gmailStatus().then(s => { gmail = s; setTimeout(verificarBackupDiario, 8000); });
    setInterval(verificarBackupDiario, 30 * 60 * 1000);
  }
})();
