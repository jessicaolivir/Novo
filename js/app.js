/* Sistema PDV: vendas, produtos, caixa, relatórios e configurações.
 * Valores monetários são armazenados em centavos (inteiros) para evitar
 * erros de arredondamento de ponto flutuante. */
(function () {
  'use strict';

  const STORAGE_KEY = 'pdv_db_v1';
  const FORMAS = {
    dinheiro: 'Dinheiro',
    debito: 'Cartão de débito',
    credito: 'Cartão de crédito',
    pix: 'PIX'
  };

  // ---------- Utilidades ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = cents => brl.format((cents || 0) / 100);
  const fmtQtd = q => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtData = iso => iso ? new Date(iso).toLocaleString('pt-BR') : '';

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

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();
  const dateKey = d => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

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
        bloquearSemEstoque: false
      }
    };
  }

  function carregarDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return dbPadrao();
      const data = JSON.parse(raw);
      const base = dbPadrao();
      return {
        ...base, ...data,
        seq: { ...base.seq, ...(data.seq || {}) },
        config: { ...base.config, ...(data.config || {}) }
      };
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
      toast('Não foi possível salvar os dados neste navegador.', 'err');
    }
  }

  const caixaAberto = () => db.caixas.find(c => !c.fechamento) || null;
  const produtoPorId = id => db.produtos.find(p => p.id === id);
  const produtoPorCodigo = cod => db.produtos.find(p => p.codigo && p.codigo === cod);

  // ---------- UI geral ----------
  let toastTimer;
  function toast(msg, tipo = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast no-print ' + tipo;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  let onModalClose = null;
  function abrirModal(titulo, html, onClose) {
    $('#modalTitulo').textContent = titulo;
    $('#modalCorpo').innerHTML = html;
    $('#modalBg').classList.remove('hidden');
    onModalClose = onClose || null;
    const first = $('#modalCorpo [autofocus]') || $('#modalCorpo input, #modalCorpo select');
    if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 30);
  }
  function fecharModal() {
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
    if (view === 'produtos') renderProdutos();
    if (view === 'caixa') renderCaixa();
    if (view === 'relatorios') renderRelatorios();
    if (view === 'config') renderConfig();
    if (view === 'vendas') setTimeout(() => $('#inputBusca').focus(), 0);
  }

  function renderStatusCaixa() {
    const c = caixaAberto();
    $('#caixaStatus').innerHTML = c
      ? `<span class="dot" style="background:#22c55e"></span>Caixa nº ${c.numero} aberto<br><small>desde ${fmtData(c.abertura)}</small>`
      : `<span class="dot" style="background:#ef4444"></span>Caixa fechado`;
    $('#brandName').textContent = db.config.nomeLoja || 'PDV';
  }

  // ---------- VENDA (carrinho) ----------
  let carrinho = [];   // {produtoId, codigo, nome, unidade, preco, custo, qtd}
  let sugestoesAtuais = [];
  let sugSel = -1;

  function subtotal() {
    return carrinho.reduce((s, i) => s + Math.round(i.preco * i.qtd), 0);
  }
  function descontoAplicado(sub) {
    const tipo = $('#tipoDesconto').value;
    const raw = $('#inputDesconto').value;
    if (!raw.trim()) return 0;
    if (tipo === 'perc') {
      const p = Number(raw.replace(',', '.'));
      if (!Number.isFinite(p) || p <= 0) return 0;
      return Math.min(sub, Math.round(sub * Math.min(p, 100) / 100));
    }
    const v = parseMoney(raw);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.min(sub, v);
  }

  function renderCarrinho() {
    const tbody = $('#carrinhoBody');
    tbody.innerHTML = carrinho.map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(i.nome)}<br><small class="muted">${esc(i.codigo || '')}</small></td>
        <td class="r"><input class="qtd-edit" type="number" min="0.001" step="0.001" value="${i.qtd}" data-idx="${idx}"> ${esc(i.unidade)}</td>
        <td class="r">${fmt(i.preco)}</td>
        <td class="r"><strong>${fmt(Math.round(i.preco * i.qtd))}</strong></td>
        <td class="r"><button class="btn small danger" data-rm="${idx}" title="Remover item">✕</button></td>
      </tr>`).join('');
    $('#carrinhoVazio').classList.toggle('hidden', carrinho.length > 0);

    const sub = subtotal();
    const desc = descontoAplicado(sub);
    $('#totItens').textContent = fmtQtd(carrinho.reduce((s, i) => s + i.qtd, 0));
    $('#totSubtotal').textContent = fmt(sub);
    $('#totDesconto').textContent = '− ' + fmt(desc);
    $('#totTotal').textContent = fmt(sub - desc);
  }

  function qtdNoCarrinho(produtoId) {
    return carrinho.filter(i => i.produtoId === produtoId).reduce((s, i) => s + i.qtd, 0);
  }

  function adicionarAoCarrinho(produto, qtd) {
    if (!(qtd > 0)) { toast('Quantidade inválida.', 'err'); return false; }
    if (db.config.bloquearSemEstoque && qtdNoCarrinho(produto.id) + qtd > produto.estoque) {
      toast(`Estoque insuficiente de "${produto.nome}" (disponível: ${fmtQtd(produto.estoque)}).`, 'err');
      return false;
    }
    const existente = carrinho.find(i => i.produtoId === produto.id);
    if (existente) {
      existente.qtd = Math.round((existente.qtd + qtd) * 1000) / 1000;
    } else {
      carrinho.push({
        produtoId: produto.id, codigo: produto.codigo, nome: produto.nome,
        unidade: produto.unidade || 'UN', preco: produto.preco, custo: produto.custo || 0, qtd
      });
    }
    renderCarrinho();
    return true;
  }

  function lerEntrada() {
    let termo = $('#inputBusca').value.trim();
    let qtd = Number(String($('#inputQtd').value).replace(',', '.')) || 1;
    const m = termo.match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/);
    if (m) { qtd = Number(m[1].replace(',', '.')); termo = m[2].trim(); }
    return { termo, qtd };
  }

  function buscarProdutos(termo) {
    const t = termo.toLowerCase();
    if (!t) return [];
    return db.produtos.filter(p =>
      (p.codigo || '').toLowerCase().includes(t) ||
      p.nome.toLowerCase().includes(t)
    ).slice(0, 12);
  }

  function renderSugestoes() {
    const { termo } = lerEntrada();
    sugestoesAtuais = buscarProdutos(termo);
    sugSel = sugestoesAtuais.length ? 0 : -1;
    const ul = $('#sugestoes');
    if (!termo || !sugestoesAtuais.length) { ul.classList.add('hidden'); return; }
    ul.innerHTML = sugestoesAtuais.map((p, i) => `
      <li data-i="${i}" class="${i === sugSel ? 'sel' : ''}">
        <span>${esc(p.nome)} <small>${esc(p.codigo || '')}</small></span>
        <span><strong>${fmt(p.preco)}</strong> <small>est. ${fmtQtd(p.estoque)}</small></span>
      </li>`).join('');
    ul.classList.remove('hidden');
  }
  function marcarSugestao() {
    $$('#sugestoes li').forEach((li, i) => li.classList.toggle('sel', i === sugSel));
    const sel = $('#sugestoes li.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function limparEntrada() {
    $('#inputBusca').value = '';
    $('#inputQtd').value = 1;
    $('#sugestoes').classList.add('hidden');
    sugestoesAtuais = [];
    $('#inputBusca').focus();
  }

  function submeterItem(produtoEscolhido) {
    const { termo, qtd } = lerEntrada();
    if (!termo && !produtoEscolhido) return;
    let p = produtoEscolhido || produtoPorCodigo(termo);
    if (!p) {
      const lista = buscarProdutos(termo);
      if (lista.length === 1) p = lista[0];
      else if (lista.length > 1 && sugSel >= 0 && sugestoesAtuais[sugSel]) p = sugestoesAtuais[sugSel];
    }
    if (!p) { toast(`Produto não encontrado: "${termo}".`, 'err'); return; }
    if (adicionarAoCarrinho(p, qtd)) limparEntrada();
  }

  function cancelarVendaAtual() {
    if (!carrinho.length) return;
    confirmar('Cancelar venda', 'Deseja descartar todos os itens da venda atual?', () => {
      carrinho = [];
      $('#inputDesconto').value = '';
      renderCarrinho();
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
      <div class="pag-resumo">
        <div><span>Total</span><strong>${fmt(total)}</strong></div>
        <div><span>Pago</span><strong id="pgPago">R$ 0,00</strong></div>
        <div><span id="pgRestLbl">Restante</span><strong id="pgRest">${fmt(total)}</strong></div>
      </div>
      <div class="formas">
        ${Object.entries(FORMAS).map(([k, v], i) =>
          `<button type="button" class="btn ${k === forma ? 'sel' : ''}" data-forma="${k}">${i + 1}. ${v}</button>`).join('')}
      </div>
      <form class="pag-add" id="pgForm">
        <input id="pgValor" type="text" inputmode="decimal" autofocus>
        <button class="btn primary" type="submit">Lançar</button>
      </form>
      <table class="table"><tbody id="pgLista"></tbody></table>
      <div class="modal-actions">
        <button class="btn" id="pgVoltar">Voltar</button>
        <button class="btn success" id="pgConfirmar" disabled>Concluir venda</button>
      </div>`);

    const pago = () => pagamentos.reduce((s, p) => s + p.valor, 0);
    const restante = () => Math.max(0, total - pago());

    function atualizar() {
      const pg = pago();
      $('#pgPago').textContent = fmt(pg);
      if (pg > total) {
        $('#pgRestLbl').textContent = 'Troco';
        $('#pgRest').textContent = fmt(pg - total);
      } else {
        $('#pgRestLbl').textContent = 'Restante';
        $('#pgRest').textContent = fmt(total - pg);
      }
      $('#pgLista').innerHTML = pagamentos.map((p, i) => `
        <tr><td>${FORMAS[p.forma]}</td><td class="r">${fmt(p.valor)}</td>
        <td class="r"><button class="btn small" data-rmpg="${i}">remover</button></td></tr>`).join('');
      $('#pgConfirmar').disabled = pg < total;
      $('#pgValor').value = moneyInput(restante());
    }

    $$('#modalCorpo [data-forma]').forEach(b => b.onclick = () => {
      forma = b.dataset.forma;
      $$('#modalCorpo [data-forma]').forEach(x => x.classList.toggle('sel', x === b));
      $('#pgValor').focus(); $('#pgValor').select();
    });

    $('#pgForm').onsubmit = e => {
      e.preventDefault();
      const v = parseMoney($('#pgValor').value);
      if (!Number.isFinite(v) || v <= 0) {
        if (pago() >= total) { concluir(); return; }
        toast('Informe um valor válido.', 'err'); return;
      }
      const falta = restante();
      if (falta === 0) { toast('O total já foi pago.', 'err'); return; }
      if (forma !== 'dinheiro' && v > falta) {
        toast('Somente pagamentos em dinheiro podem gerar troco.', 'err'); return;
      }
      pagamentos.push({ forma, valor: v });
      atualizar();
      if (pago() >= total) $('#pgConfirmar').focus();
      else { $('#pgValor').focus(); $('#pgValor').select(); }
    };

    $('#pgLista').onclick = e => {
      const i = e.target.dataset.rmpg;
      if (i !== undefined) { pagamentos.splice(Number(i), 1); atualizar(); }
    };
    $('#pgValor').onkeydown = e => {
      if (/^[1-4]$/.test(e.key) && e.altKey) {
        e.preventDefault();
        $$('#modalCorpo [data-forma]')[Number(e.key) - 1].click();
      }
    };
    $('#pgVoltar').onclick = () => fecharModal();
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
      id: uid(),
      numero: db.seq.venda,
      data: nowISO(),
      caixaId: caixa.id,
      itens: carrinho.map(i => ({ ...i })),
      subtotal: sub,
      desconto: desc,
      total,
      pagamentos,
      troco: Math.max(0, pago - total),
      status: 'concluida'
    };
    venda.itens.forEach(i => {
      const p = produtoPorId(i.produtoId);
      if (p) p.estoque = Math.round((p.estoque - i.qtd) * 1000) / 1000;
    });
    db.vendas.push(venda);
    salvar();
    carrinho = [];
    $('#inputDesconto').value = '';
    renderCarrinho();
    return venda;
  }

  function posVenda(venda) {
    abrirModal('Venda concluída', `
      <p style="font-size:18px">Venda nº <strong>${venda.numero}</strong> registrada no valor de <strong>${fmt(venda.total)}</strong>.</p>
      ${venda.troco > 0 ? `<p style="font-size:26px">Troco: <strong class="pos">${fmt(venda.troco)}</strong></p>` : ''}
      <div class="modal-actions">
        <button class="btn" id="pvImprimir">Imprimir cupom</button>
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
          <tr><td>${fmtQtd(i.qtd)} ${esc(i.unidade)} x ${fmt(i.preco)}</td><td class="r">${fmt(Math.round(i.preco * i.qtd))}</td></tr>`).join('')}
      </table>
      <hr>
      <table>
        <tr><td>Subtotal</td><td class="r">${fmt(venda.subtotal)}</td></tr>
        ${venda.desconto ? `<tr><td>Desconto</td><td class="r">-${fmt(venda.desconto)}</td></tr>` : ''}
        <tr class="big"><td>TOTAL</td><td class="r">${fmt(venda.total)}</td></tr>
        ${venda.pagamentos.map(p => `<tr><td>${FORMAS[p.forma]}</td><td class="r">${fmt(p.valor)}</td></tr>`).join('')}
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
    const min = Number(db.config.estoqueMinimo) || 0;
    $('#produtosBody').innerHTML = lista.map(p => `
      <tr>
        <td>${esc(p.codigo)}</td>
        <td>${esc(p.nome)}</td>
        <td>${esc(p.categoria)}</td>
        <td class="r">${fmt(p.custo)}</td>
        <td class="r"><strong>${fmt(p.preco)}</strong></td>
        <td class="r"><span class="badge ${p.estoque <= 0 ? 'err' : p.estoque <= (p.estoqueMinimo ?? min) ? 'warn' : 'ok'}">${fmtQtd(p.estoque)}</span></td>
        <td>${esc(p.unidade)}</td>
        <td class="r">
          <button class="btn small" data-estoque="${p.id}">Estoque</button>
          <button class="btn small" data-edit="${p.id}">Editar</button>
          <button class="btn small danger" data-del="${p.id}">Excluir</button>
        </td>
      </tr>`).join('');
    $('#produtosVazio').classList.toggle('hidden', lista.length > 0);
  }

  function formProduto(p) {
    const novo = !p;
    p = p || { codigo: '', nome: '', categoria: '', custo: 0, preco: 0, estoque: 0, unidade: 'UN', estoqueMinimo: '' };
    abrirModal(novo ? 'Novo produto' : 'Editar produto', `
      <form id="fProd" class="form-grid">
        <div class="field"><label>Código de barras</label><input name="codigo" value="${esc(p.codigo)}" autofocus></div>
        <div class="field"><label>Categoria</label><input name="categoria" value="${esc(p.categoria)}" list="listaCategorias"></div>
        <div class="field span2"><label>Nome *</label><input name="nome" value="${esc(p.nome)}" required></div>
        <div class="field"><label>Preço de custo (R$)</label><input name="custo" value="${moneyInput(p.custo)}" inputmode="decimal"></div>
        <div class="field"><label>Preço de venda (R$) *</label><input name="preco" value="${moneyInput(p.preco)}" inputmode="decimal" required></div>
        <div class="field"><label>${novo ? 'Estoque inicial' : 'Estoque atual'}</label><input name="estoque" type="number" step="0.001" value="${p.estoque}"></div>
        <div class="field"><label>Unidade</label>
          <select name="unidade">${['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'M'].map(u =>
            `<option ${u === p.unidade ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field"><label>Estoque mínimo (vazio = padrão)</label><input name="estoqueMinimo" type="number" min="0" step="1" value="${p.estoqueMinimo ?? ''}"></div>
        <datalist id="listaCategorias">${[...new Set(db.produtos.map(x => x.categoria).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="fpCancelar">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>`);
    $('#fpCancelar').onclick = fecharModal;
    $('#fProd').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const codigo = String(f.get('codigo')).trim();
      const nome = String(f.get('nome')).trim();
      const preco = parseMoney(f.get('preco'));
      const custo = parseMoney(f.get('custo'));
      const estoque = Number(f.get('estoque')) || 0;
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
    abrirModal(`Movimentar estoque: ${p.nome}`, `
      <p>Estoque atual: <strong>${fmtQtd(p.estoque)} ${esc(p.unidade)}</strong></p>
      <form id="fEst" class="form-grid">
        <div class="field"><label>Operação</label>
          <select name="op"><option value="entrada">Entrada (+)</option><option value="saida">Saída / perda (−)</option><option value="ajuste">Definir quantidade</option></select></div>
        <div class="field"><label>Quantidade</label><input name="qtd" type="number" step="0.001" min="0" required autofocus></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="feCancelar">Cancelar</button>
          <button class="btn primary" type="submit">Aplicar</button>
        </div>
      </form>`);
    $('#feCancelar').onclick = fecharModal;
    $('#fEst').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const q = Number(f.get('qtd'));
      if (!(q >= 0)) return toast('Quantidade inválida.', 'err');
      const op = f.get('op');
      if (op === 'entrada') p.estoque += q;
      else if (op === 'saida') p.estoque -= q;
      else p.estoque = q;
      p.estoque = Math.round(p.estoque * 1000) / 1000;
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
    const sangrias = c.movimentos.filter(m => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
    const suprimentos = c.movimentos.filter(m => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
    const totalVendas = vendas.reduce((s, v) => s + v.total, 0);
    const esperadoDinheiro = c.valorInicial + porForma.dinheiro + suprimentos - sangrias;
    return { vendas, porForma, sangrias, suprimentos, totalVendas, esperadoDinheiro };
  }

  function renderCaixa() {
    const c = caixaAberto();
    const painel = $('#caixaPainel');
    if (!c) {
      painel.innerHTML = `
        <div class="card">
          <p>O caixa está <strong>fechado</strong>. Informe o valor em dinheiro disponível na gaveta para abrir.</p>
          <form id="fAbrir" class="pag-add" style="max-width:420px">
            <input name="valor" placeholder="Fundo de troco (R$)" value="0,00" inputmode="decimal">
            <button class="btn success" type="submit">Abrir caixa</button>
          </form>
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
        toast('Caixa aberto.', 'ok');
      };
    } else {
      const r = resumoCaixa(c);
      painel.innerHTML = `
        <div class="card">
          <p>Caixa nº <strong>${c.numero}</strong> aberto em ${fmtData(c.abertura)}.</p>
          <div class="caixa-grid">
            <div class="kpi"><span>Fundo inicial</span><strong>${fmt(c.valorInicial)}</strong></div>
            <div class="kpi"><span>Vendas (${r.vendas.length})</span><strong>${fmt(r.totalVendas)}</strong></div>
            <div class="kpi"><span>Suprimentos / Sangrias</span><strong>${fmt(r.suprimentos)} / ${fmt(r.sangrias)}</strong></div>
            <div class="kpi"><span>Dinheiro esperado na gaveta</span><strong>${fmt(r.esperadoDinheiro)}</strong></div>
          </div>
          <table class="table" style="max-width:420px">
            ${Object.entries(FORMAS).map(([k, v]) => `<tr><td>${v}</td><td class="r">${fmt(r.porForma[k])}</td></tr>`).join('')}
          </table>
          <div class="row-btns" style="margin-top:14px">
            <button class="btn" id="btnSuprimento">+ Suprimento</button>
            <button class="btn" id="btnSangria">− Sangria</button>
            <button class="btn danger" id="btnFecharCaixa">Fechar caixa</button>
          </div>
          ${c.movimentos.length ? `
            <h3>Movimentações</h3>
            <table class="table">
              ${c.movimentos.map(m => `<tr><td>${fmtData(m.data)}</td><td>${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}</td><td>${esc(m.motivo)}</td><td class="r ${m.tipo === 'sangria' ? 'neg' : 'pos'}">${fmt(m.valor)}</td></tr>`).join('')}
            </table>` : ''}
        </div>`;
      $('#btnSuprimento').onclick = () => movimentoCaixa(c, 'suprimento');
      $('#btnSangria').onclick = () => movimentoCaixa(c, 'sangria');
      $('#btnFecharCaixa').onclick = () => fecharCaixa(c);
    }

    $('#caixasBody').innerHTML = db.caixas.slice().reverse().map(cx => {
      const r = resumoCaixa(cx);
      const dif = cx.valorContado == null ? null : cx.valorContado - r.esperadoDinheiro;
      return `<tr>
        <td>${cx.numero}</td>
        <td>${fmtData(cx.abertura)}</td>
        <td>${cx.fechamento ? fmtData(cx.fechamento) : '<span class="badge ok">aberto</span>'}</td>
        <td class="r">${fmt(cx.valorInicial)}</td>
        <td class="r">${fmt(r.totalVendas)}</td>
        <td class="r">${fmt(r.esperadoDinheiro)}</td>
        <td class="r">${cx.valorContado == null ? '' : fmt(cx.valorContado)}</td>
        <td class="r ${dif == null ? '' : dif < 0 ? 'neg' : dif > 0 ? 'pos' : ''}">${dif == null ? '' : fmt(dif)}</td>
      </tr>`;
    }).join('');
  }

  function movimentoCaixa(c, tipo) {
    abrirModal(tipo === 'sangria' ? 'Sangria (retirada)' : 'Suprimento (reforço)', `
      <form id="fMov" class="form-grid">
        <div class="field"><label>Valor (R$)</label><input name="valor" inputmode="decimal" required autofocus></div>
        <div class="field"><label>Motivo</label><input name="motivo"></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="fmCancelar">Cancelar</button>
          <button class="btn primary" type="submit">Confirmar</button>
        </div>
      </form>`);
    $('#fmCancelar').onclick = fecharModal;
    $('#fMov').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = parseMoney(f.get('valor'));
      if (!Number.isFinite(v) || v <= 0) return toast('Valor inválido.', 'err');
      if (tipo === 'sangria' && v > resumoCaixa(c).esperadoDinheiro) {
        return toast('Valor da sangria maior que o dinheiro disponível no caixa.', 'err');
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
      <p>Dinheiro esperado na gaveta: <strong>${fmt(r.esperadoDinheiro)}</strong></p>
      <form id="fFechar" class="form-grid">
        <div class="field span2"><label>Valor contado em dinheiro (R$)</label><input name="contado" inputmode="decimal" value="${moneyInput(r.esperadoDinheiro)}" required autofocus></div>
        <div class="span2 modal-actions">
          <button type="button" class="btn" id="ffCancelar">Cancelar</button>
          <button class="btn danger" type="submit">Fechar caixa</button>
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
    };
  }

  // ---------- RELATÓRIOS ----------
  function definirPeriodo(de, ate) {
    $('#relDe').value = dateKey(de);
    $('#relAte').value = dateKey(ate);
    renderRelatorios();
  }

  function renderRelatorios() {
    if (!$('#relDe').value) { const h = new Date(); $('#relDe').value = dateKey(h); $('#relAte').value = dateKey(h); }
    const de = $('#relDe').value, ate = $('#relAte').value;
    const doPeriodo = db.vendas.filter(v => { const k = dateKey(v.data); return k >= de && k <= ate; });
    const concl = doPeriodo.filter(v => v.status === 'concluida');

    const fat = concl.reduce((s, v) => s + v.total, 0);
    const custo = concl.reduce((s, v) => s + v.itens.reduce((a, i) => a + Math.round((i.custo || 0) * i.qtd), 0), 0);
    $('#kpiFat').textContent = fmt(fat);
    $('#kpiQtd').textContent = concl.length;
    $('#kpiTicket').textContent = fmt(concl.length ? Math.round(fat / concl.length) : 0);
    $('#kpiLucro').textContent = fmt(fat - custo);

    const porForma = Object.fromEntries(Object.keys(FORMAS).map(k => [k, 0]));
    concl.forEach(v => { v.pagamentos.forEach(p => porForma[p.forma] += p.valor); porForma.dinheiro -= v.troco; });
    $('#relPagamentos').innerHTML = Object.entries(FORMAS)
      .map(([k, n]) => `<tr><td>${n}</td><td class="r">${fmt(porForma[k])}</td></tr>`).join('');

    const top = {};
    concl.forEach(v => v.itens.forEach(i => {
      const t = top[i.produtoId] || (top[i.produtoId] = { nome: i.nome, unidade: i.unidade, qtd: 0, total: 0 });
      t.qtd += i.qtd;
      t.total += Math.round(i.preco * i.qtd);
    }));
    const topList = Object.values(top).sort((a, b) => b.total - a.total).slice(0, 10);
    $('#relTop').innerHTML = topList.length
      ? topList.map(t => `<tr><td>${esc(t.nome)}</td><td class="r">${fmtQtd(t.qtd)} ${esc(t.unidade)}</td><td class="r">${fmt(t.total)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">Sem vendas no período.</td></tr>';

    $('#relVendas').innerHTML = doPeriodo.slice().reverse().map(v => `
      <tr class="${v.status === 'cancelada' ? 'cancelada' : ''}">
        <td>${v.numero}</td>
        <td>${fmtData(v.data)}</td>
        <td class="r">${v.itens.length}</td>
        <td>${[...new Set(v.pagamentos.map(p => FORMAS[p.forma]))].join(', ')}</td>
        <td class="r">${fmt(v.total)}</td>
        <td><span class="badge ${v.status === 'cancelada' ? 'err' : 'ok'}">${v.status === 'cancelada' ? 'cancelada' : 'concluída'}</span></td>
        <td class="r">
          <button class="btn small" data-ver="${v.id}">Ver</button>
          <button class="btn small" data-print="${v.id}">Cupom</button>
          ${v.status === 'concluida' ? `<button class="btn small danger" data-cancel="${v.id}">Cancelar</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma venda no período.</td></tr>';

    const minPadrao = Number(db.config.estoqueMinimo) || 0;
    const baixos = db.produtos.filter(p => p.estoque <= (p.estoqueMinimo ?? minPadrao))
      .sort((a, b) => a.estoque - b.estoque);
    $('#relEstoque').innerHTML = baixos.length
      ? baixos.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nome)}</td><td class="r ${p.estoque <= 0 ? 'neg' : ''}">${fmtQtd(p.estoque)}</td><td class="r">${fmtQtd(p.estoqueMinimo ?? minPadrao)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Nenhum produto com estoque baixo.</td></tr>';
  }

  function verVenda(v) {
    abrirModal(`Venda nº ${v.numero}`, `
      <p>${fmtData(v.data)} · <span class="badge ${v.status === 'cancelada' ? 'err' : 'ok'}">${v.status}</span></p>
      <table class="table">
        <thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Unit.</th><th class="r">Total</th></tr></thead>
        <tbody>${v.itens.map(i => `<tr><td>${esc(i.nome)}</td><td class="r">${fmtQtd(i.qtd)}</td><td class="r">${fmt(i.preco)}</td><td class="r">${fmt(Math.round(i.preco * i.qtd))}</td></tr>`).join('')}</tbody>
      </table>
      <table class="table">
        <tr><td>Subtotal</td><td class="r">${fmt(v.subtotal)}</td></tr>
        <tr><td>Desconto</td><td class="r">${fmt(v.desconto)}</td></tr>
        <tr><td><strong>Total</strong></td><td class="r"><strong>${fmt(v.total)}</strong></td></tr>
        ${v.pagamentos.map(p => `<tr><td>${FORMAS[p.forma]}</td><td class="r">${fmt(p.valor)}</td></tr>`).join('')}
        <tr><td>Troco</td><td class="r">${fmt(v.troco)}</td></tr>
      </table>
      ${v.motivoCancelamento ? `<p>Motivo do cancelamento: ${esc(v.motivoCancelamento)}</p>` : ''}`);
  }

  function cancelarVendaRegistrada(v) {
    const cx = db.caixas.find(c => c.id === v.caixaId);
    if (!cx || cx.fechamento) return toast('Só é possível cancelar vendas do caixa atualmente aberto.', 'err');
    abrirModal(`Cancelar venda nº ${v.numero}`, `
      <p>Os itens retornarão ao estoque e o valor de ${fmt(v.total)} será estornado do caixa.</p>
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
        if (p) p.estoque = Math.round((p.estoque + i.qtd) * 1000) / 1000;
      });
      salvar();
      fecharModal();
      renderRelatorios();
      toast('Venda cancelada e estoque restaurado.', 'ok');
    };
  }

  // ---------- CONFIGURAÇÕES ----------
  function renderConfig() {
    const f = $('#formConfig');
    Object.entries(db.config).forEach(([k, v]) => {
      const el = f.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
  }

  function produtosExemplo() {
    const ex = [
      ['7891000100103', 'Leite Integral 1L', 'Laticínios', 389, 549, 48, 'UN'],
      ['7891910000197', 'Açúcar Refinado 1kg', 'Mercearia', 349, 529, 30, 'UN'],
      ['7896005800018', 'Café Torrado e Moído 500g', 'Mercearia', 1290, 1899, 25, 'UN'],
      ['7891149103102', 'Refrigerante Cola 2L', 'Bebidas', 659, 999, 40, 'UN'],
      ['7896004000021', 'Arroz Branco 5kg', 'Mercearia', 1890, 2799, 20, 'UN'],
      ['7896102500012', 'Feijão Carioca 1kg', 'Mercearia', 549, 849, 3, 'UN'],
      ['2000000000015', 'Pão Francês', 'Padaria', 900, 1599, 15, 'KG'],
      ['7891024134702', 'Sabonete 90g', 'Higiene', 129, 249, 60, 'UN'],
      ['7896036090244', 'Detergente 500ml', 'Limpeza', 179, 299, 0, 'UN'],
      ['7891008121216', 'Biscoito Recheado 140g', 'Mercearia', 199, 349, 35, 'UN']
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

  function exportar() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-pdv-${dateKey(new Date())}.json`;
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
        confirmar('Importar backup', 'Os dados atuais serão substituídos pelo conteúdo do arquivo. Continuar?', () => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          db = carregarDB();
          carrinho = [];
          renderTudo();
          toast('Backup importado.', 'ok');
        }, 'Importar');
      } catch (e) {
        toast('Arquivo de backup inválido.', 'err');
      }
    };
    reader.readAsText(file);
  }

  function renderTudo() {
    renderStatusCaixa();
    renderCarrinho();
    irPara(viewAtual);
  }

  // ---------- Eventos ----------
  function bind() {
    $$('.nav-btn').forEach(b => b.onclick = () => irPara(b.dataset.view));

    // Venda
    $('#formAddItem').onsubmit = e => { e.preventDefault(); submeterItem(); };
    $('#inputBusca').addEventListener('input', renderSugestoes);
    $('#inputBusca').addEventListener('keydown', e => {
      const ul = $('#sugestoes');
      if (ul.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sugSel = Math.min(sugSel + 1, sugestoesAtuais.length - 1); marcarSugestao(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sugSel = Math.max(sugSel - 1, 0); marcarSugestao(); }
      else if (e.key === 'Escape') { ul.classList.add('hidden'); }
    });
    $('#inputBusca').addEventListener('blur', () => setTimeout(() => $('#sugestoes').classList.add('hidden'), 150));
    $('#sugestoes').addEventListener('mousedown', e => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      submeterItem(sugestoesAtuais[Number(li.dataset.i)]);
    });
    $('#carrinhoBody').addEventListener('click', e => {
      const i = e.target.dataset.rm;
      if (i !== undefined) { carrinho.splice(Number(i), 1); renderCarrinho(); $('#inputBusca').focus(); }
    });
    $('#carrinhoBody').addEventListener('change', e => {
      if (!e.target.classList.contains('qtd-edit')) return;
      const item = carrinho[Number(e.target.dataset.idx)];
      const q = Number(String(e.target.value).replace(',', '.'));
      if (!(q > 0)) { toast('Quantidade inválida.', 'err'); renderCarrinho(); return; }
      const p = produtoPorId(item.produtoId);
      if (db.config.bloquearSemEstoque && p && q > p.estoque) {
        toast(`Estoque insuficiente (disponível: ${fmtQtd(p.estoque)}).`, 'err'); renderCarrinho(); return;
      }
      item.qtd = q;
      renderCarrinho();
    });
    $('#inputDesconto').addEventListener('input', renderCarrinho);
    $('#tipoDesconto').addEventListener('change', renderCarrinho);
    $('#btnFinalizar').onclick = abrirPagamento;
    $('#btnCancelarVenda').onclick = cancelarVendaAtual;

    // Produtos
    $('#btnNovoProduto').onclick = () => formProduto(null);
    $('#buscaProduto').addEventListener('input', renderProdutos);
    $('#produtosBody').addEventListener('click', e => {
      const d = e.target.dataset;
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
    $('#relDe').addEventListener('change', renderRelatorios);
    $('#relAte').addEventListener('change', renderRelatorios);
    $('#btnRelHoje').onclick = () => definirPeriodo(new Date(), new Date());
    $('#btnRelMes').onclick = () => { const h = new Date(); definirPeriodo(new Date(h.getFullYear(), h.getMonth(), 1), h); };
    $('#relVendas').addEventListener('click', e => {
      const d = e.target.dataset;
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
      db.config = {
        ...db.config,
        nomeLoja: f.nomeLoja.value.trim() || 'Minha Loja',
        cnpj: f.cnpj.value.trim(),
        endereco: f.endereco.value.trim(),
        telefone: f.telefone.value.trim(),
        mensagemCupom: f.mensagemCupom.value.trim(),
        estoqueMinimo: Number(f.estoqueMinimo.value) || 0,
        bloquearSemEstoque: f.bloquearSemEstoque.checked
      };
      salvar();
      renderStatusCaixa();
      toast('Configurações salvas.', 'ok');
    };
    $('#btnExportar').onclick = exportar;
    $('#inputImportar').onchange = e => { if (e.target.files[0]) importar(e.target.files[0]); e.target.value = ''; };
    $('#btnExemplo').onclick = () => {
      const n = produtosExemplo();
      toast(n ? `${n} produtos de exemplo adicionados.` : 'Os produtos de exemplo já existem.', 'ok');
    };
    $('#btnLimpar').onclick = () => confirmar('Apagar todos os dados',
      'Todos os produtos, vendas e caixas serão apagados definitivamente. Exporte um backup antes, se necessário.', () => {
        localStorage.removeItem(STORAGE_KEY);
        db = dbPadrao();
        carrinho = [];
        renderTudo();
        renderConfig();
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
  if (!db.produtos.length && !db.vendas.length) {
    toast('Bem-vindo! Cadastre produtos ou carregue os exemplos em Configurações.');
  }
})();
