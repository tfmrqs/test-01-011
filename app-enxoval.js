/**
 * MOTOR DO SISTEMA DE ENXOVAIS - PMDF
 * Módulo reutilizável para todos os cursos
 */

const AppEnxoval = (function () {
  // Estado interno isolado por instância
  let config = {
    urlItens: '',
    urlPrecos: '',
    storageKey: 'enxoval_pmdf_state',
    tempoExpiracaoMs: 5 * 60 * 1000, // 5 minutos padrão
    tituloCurso: 'ENXOVAL OPERACIONAL',
    subtituloCurso: 'Relatório de Orçamento Regulamentar',
    nomeArquivoPdf: 'Orcamento_Enxoval'
  };

  let listaItens = [];
  let listaPrecos = [];
  let selecoesUsuario = {};

  // Segurança de navegação e atalhos
  function aplicarSeguranca() {
    if (window.location.pathname.endsWith('.html')) {
      window.history.replaceState(null, document.title, window.location.pathname.replace(/\/[^\/]+\.html$/, '/'));
    }

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => {
      if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
      if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) { e.preventDefault(); return false; }
      if (e.ctrlKey && ['u', 'U', 's', 'S'].includes(e.key)) { e.preventDefault(); return false; }
    });
  }

  // Persistência Temporária (5 Minutos)
  function salvarSessao() {
    try {
      localStorage.setItem(config.storageKey, JSON.stringify({
        timestamp: Date.now(),
        dados: selecoesUsuario
      }));
    } catch (e) {
      console.warn('Falha ao salvar sessão:', e);
    }
  }

  function carregarSessao() {
    try {
      const salvo = localStorage.getItem(config.storageKey);
      if (!salvo) return;
      const payload = JSON.parse(salvo);
      if (Date.now() - payload.timestamp > config.tempoExpiracaoMs) {
        localStorage.removeItem(config.storageKey);
        selecoesUsuario = {};
      } else {
        selecoesUsuario = payload.dados || {};
      }
    } catch (e) {
      localStorage.removeItem(config.storageKey);
      selecoesUsuario = {};
    }
  }

  // Leitura de CSV via PapaParse
  async function carregarCSV(url) {
    const resposta = await fetch(url, { redirect: 'follow' });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    const texto = await resposta.text();
    return new Promise((resolve, reject) => {
      Papa.parse(texto, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: h => h.trim(),
        complete: res => resolve(res.data),
        error: err => reject(err)
      });
    });
  }

  // Auxiliares de parsing de dados
  function obterPropriedade(objeto, chavesPossiveis) {
    if (!objeto) return '';
    const normalizar = str => String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const chavesObjeto = Object.keys(objeto);
    for (const chave of chavesPossiveis) {
      const chaveNorm = normalizar(chave);
      const match = chavesObjeto.find(k => normalizar(k) === chaveNorm);
      if (match && objeto[match] !== undefined && objeto[match] !== null) {
        return String(objeto[match]).trim();
      }
    }
    return '';
  }

  function converterPreco(valor) {
    if (!valor) return 0;
    const numero = parseFloat(String(valor).replace('R$', '').replace(/\s/g, '').replace(',', '.'));
    return isNaN(numero) ? 0 : numero;
  }

  function preencherFiltroFases() {
    const selectFase = document.getElementById('filterFase');
    if (!selectFase) return;
    const fases = [...new Set(listaItens.map(item => obterPropriedade(item, ['Fase', 'Etapa'])).filter(Boolean))];
    selectFase.innerHTML = '<option value="">Todas as Fases</option>' + fases.map(fase => `<option value="${fase}">${fase}</option>`).join('');
  }

  function aplicarFiltros() {
    const selectFase = document.getElementById('filterFase');
    const inputBusca = document.getElementById('searchItem');
    const faseEscolhida = selectFase ? selectFase.value : '';
    const termoBusca = inputBusca ? inputBusca.value.toLowerCase() : '';

    const itensFiltrados = listaItens.filter(item => {
      const nome = obterPropriedade(item, ['Item', 'Nome_Item', 'Nome', 'Descricao']).toLowerCase();
      const fase = obterPropriedade(item, ['Fase', 'Etapa']);
      return (!faseEscolhida || fase === faseEscolhida) && (!termoBusca || nome.includes(termoBusca));
    });

    renderCards(itensFiltrados);
    calcularTotal();
    renderSidebar();
  }

  function renderCards(itens) {
    const container = document.getElementById('gridItens');
    if (!container) return;
    if (!itens.length) {
      container.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;">Nenhum item encontrado.</p>';
      return;
    }

    container.innerHTML = itens.map(item => {
      const id = obterPropriedade(item, ['ID_Item', 'ID', 'Codigo']);
      const nome = obterPropriedade(item, ['Item', 'Nome_Item', 'Nome', 'Descricao']) || 'Item sem nome';
      const fase = obterPropriedade(item, ['Fase', 'Etapa']);
      const especificacao = obterPropriedade(item, ['Especificacao', 'Especificação', 'Detalhes']);
      const imagem = obterPropriedade(item, ['URL_Imagem', 'Imagem', 'Foto']);
      const qtdPadrao = parseInt(obterPropriedade(item, ['Qtd_Padrao', 'Qtd', 'Quantidade'])) || 1;

      const ofertas = listaPrecos.filter(preco => {
        const precoId = obterPropriedade(preco, ['ID_Item', 'ID', 'Codigo']);
        const precoItem = obterPropriedade(preco, ['Item', 'Nome_Item', 'Nome']);
        return (id && precoId && precoId.toLowerCase() === id.toLowerCase()) || 
               (nome && precoItem && precoItem.toLowerCase() === nome.toLowerCase());
      });

      const chaveItem = id || nome;
      if (!selecoesUsuario[chaveItem]) {
        selecoesUsuario[chaveItem] = {
          ofertaIndex: '',
          qtd: qtdPadrao,
          preco: 0,
          link: '',
          cupom: '',
          nome: nome,
          img: imagem || 'https://placehold.co/400x250/151d30/94a3b8?text=Sem+Foto',
          lojaLabel: ''
        };
      }

      const selecaoAtual = selecoesUsuario[chaveItem];
      const subtotal = (selecaoAtual.preco * selecaoAtual.qtd) || 0;
      const itemAtivo = selecaoAtual.ofertaIndex !== '' && selecaoAtual.preco > 0;
      const ofertaSelecionada = ofertas[parseInt(selecaoAtual.ofertaIndex, 10)];
      const cupomTexto = (ofertaSelecionada && ofertaSelecionada['CUPOM']) ? String(ofertaSelecionada['CUPOM']).trim() : '';

      return `
        <div class="card">
          <img src="${imagem || 'https://placehold.co/400x250/151d30/94a3b8?text=Sem+Foto'}" alt="${nome}" onerror="this.src='https://placehold.co/400x250/151d30/94a3b8?text=Sem+Foto'">
          <div class="card-body">
            ${fase ? `<div class="card-tags"><span class="tag tag-fase">${fase}</span></div>` : ''}
            <div class="item-title">${nome}</div>
            ${especificacao ? `<p class="item-spec">${especificacao}</p>` : ''}
            <div class="offer-box">
              <label style="font-size:0.75rem;color:var(--text-muted);">Escolha a Loja / Marca:</label>
              <select onchange="AppEnxoval.atualizarOferta('${chaveItem}', this.value, false)">
                <option value="">-- Selecione uma opção --</option>
                ${ofertas.map((oferta, idx) => {
                  const nomeLoja = obterPropriedade(oferta, ['Nome_Loja', 'Loja']);
                  const marca = obterPropriedade(oferta, ['Marca_Vendida', 'Marca', 'Modelo']);
                  const valorUnit = converterPreco(obterPropriedade(oferta, ['Preco', 'Valor']));
                  const isSelecionado = String(idx) === String(selecaoAtual.ofertaIndex);
                  return `<option value="${idx}" ${isSelecionado ? 'selected' : ''}>${nomeLoja} ${marca ? `(${marca})` : ''} - R$ ${valorUnit.toFixed(2).replace('.', ',')}</option>`;
                }).join('')}
              </select>
              <div class="controls-row">
                <div style="flex-grow:1;">
                  <label style="font-size:0.7rem;color:var(--text-muted);">Quantidade:</label>
                  <input type="number" min="1" value="${selecaoAtual.qtd}" onchange="AppEnxoval.atualizarQtd('${chaveItem}', this.value)">
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;margin-top:0.25rem;">
                ${selecaoAtual.link ? `<a href="${selecaoAtual.link}" target="_blank" rel="noopener noreferrer" class="btn-link">Ver na loja ↗</a>` : '<div></div>'}
                ${cupomTexto !== '' && cupomTexto !== '-' ? `<span class="cupom-badge">🏷️ CUPOM: ${cupomTexto}</span>` : ''}
              </div>
              <div class="card-footer">
                <span style="font-size:0.8rem;color:var(--text-muted);">Subtotal:</span>
                ${itemAtivo ? `<span class="subtotal">R$ ${subtotal.toFixed(2).replace('.', ',')}</span>` : `<span class="subtotal pendente">Não selecionado</span>`}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function toggleSidebar(abrir) {
    const drawer = document.getElementById('sidebarDrawer');
    const overlay = document.getElementById('sidebarOverlay');
    if (!drawer || !overlay) return;
    if (abrir) {
      drawer.classList.add('active');
      overlay.classList.add('active');
    } else {
      drawer.classList.remove('active');
      overlay.classList.remove('active');
    }
  }

  function renderSidebar() {
    const container = document.getElementById('sidebarItemsList');
    if (!container) return;
    const itensSelecionados = Object.entries(selecoesUsuario).filter(([_, item]) => item.ofertaIndex !== '' && item.preco > 0);
    const btnExportar = document.getElementById('btnExportarPdf');
    const cartCountBadge = document.getElementById('cartCountBadge');
    const sidebarCount = document.getElementById('sidebarCount');

    if (cartCountBadge) cartCountBadge.innerText = itensSelecionados.length;
    if (sidebarCount) sidebarCount.innerText = itensSelecionados.length;
    if (btnExportar) btnExportar.disabled = itensSelecionados.length === 0;

    if (!itensSelecionados.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;margin-top:2rem;">Nenhum item selecionado ainda.<br>Escolha uma loja/marca nos cards ao lado!</p>';
      return;
    }

    container.innerHTML = itensSelecionados.map(([chave, item]) => {
      const subtotal = item.preco * item.qtd;
      return `
        <div class="cart-item">
          <img src="${item.img}" alt="${item.nome}" onerror="this.src='https://placehold.co/400x250/151d30/94a3b8?text=Sem+Foto'">
          <div class="cart-item-details">
            <div class="cart-item-title" title="${item.nome}">${item.nome}</div>
            <div class="cart-item-loja" title="${item.lojaLabel}">${item.lojaLabel}</div>
            <div class="cart-item-price">R$ ${subtotal.toFixed(2).replace('.', ',')}</div>
          </div>
          <div class="cart-qty-ctrl">
            <button onclick="AppEnxoval.atualizarQtd('${chave}', ${item.qtd - 1})">−</button>
            <span>${item.qtd}</span>
            <button onclick="AppEnxoval.atualizarQtd('${chave}', ${item.qtd + 1})">+</button>
          </div>
          <button class="btn-remove-item" title="Remover seleção" onclick="AppEnxoval.atualizarOferta('${chave}', '')">🗑️</button>
        </div>
      `;
    }).join('');
  }

  function calcularTotal() {
    let totalGeral = 0;
    let contadorItens = 0;

    listaItens.forEach(item => {
      const chave = obterPropriedade(item, ['ID_Item', 'ID', 'Codigo']) || obterPropriedade(item, ['Item', 'Nome_Item', 'Nome']);
      const selecao = selecoesUsuario[chave];
      if (selecao && selecao.ofertaIndex !== '' && selecao.preco > 0) {
        totalGeral += selecao.preco * selecao.qtd;
        if (selecao.qtd > 0) contadorItens++;
      }
    });

    const totalFormatado = `R$ ${totalGeral.toFixed(2).replace('.', ',')}`;
    const elTotalGeral = document.getElementById('totalGeral');
    const elSidebarTotal = document.getElementById('sidebarTotal');
    const elStats = document.getElementById('statsContador');

    if (elTotalGeral) elTotalGeral.innerText = totalFormatado;
    if (elSidebarTotal) elSidebarTotal.innerText = totalFormatado;
    if (elStats) elStats.innerText = `${contadorItens} de ${listaItens.length} itens orçados`;
  }

  function atualizarOferta(chaveItem, ofertaIndex, abrirSidebar = false) {
    if (!selecoesUsuario[chaveItem]) return;

    if (ofertaIndex === '') {
      selecoesUsuario[chaveItem].ofertaIndex = '';
      selecoesUsuario[chaveItem].preco = 0;
      selecoesUsuario[chaveItem].link = '';
      selecoesUsuario[chaveItem].cupom = '';
      selecoesUsuario[chaveItem].lojaLabel = '';
    } else {
      const ofertas = listaPrecos.filter(preco => {
        const precoId = obterPropriedade(preco, ['ID_Item', 'ID', 'Codigo']);
        const precoItem = obterPropriedade(preco, ['Item', 'Nome_Item', 'Nome']);
        return (precoId && precoId.toLowerCase() === chaveItem.toLowerCase()) || 
               (precoItem && precoItem.toLowerCase() === chaveItem.toLowerCase());
      });

      const ofertaEscolhida = ofertas[parseInt(ofertaIndex, 10)];
      if (ofertaEscolhida) {
        const nomeLoja = obterPropriedade(ofertaEscolhida, ['Nome_Loja', 'Loja']);
        const marca = obterPropriedade(ofertaEscolhida, ['Marca_Vendida', 'Marca', 'Modelo']);
        selecoesUsuario[chaveItem].ofertaIndex = ofertaIndex;
        selecoesUsuario[chaveItem].preco = converterPreco(obterPropriedade(ofertaEscolhida, ['Preco', 'Valor']));
        selecoesUsuario[chaveItem].link = obterPropriedade(ofertaEscolhida, ['Link', 'URL']);
        selecoesUsuario[chaveItem].cupom = obterPropriedade(ofertaEscolhida, ['Cupom', 'CUPOM', 'Cod_Cupom']);
        selecoesUsuario[chaveItem].lojaLabel = `${nomeLoja} ${marca ? `(${marca})` : ''}`;
      }
    }

    salvarSessao();
    aplicarFiltros();
    if (abrirSidebar && ofertaIndex !== '') {
      toggleSidebar(true);
    }
  }

  function atualizarQtd(chaveItem, quantidade) {
    if (selecoesUsuario[chaveItem]) {
      selecoesUsuario[chaveItem].qtd = Math.max(1, parseInt(quantidade, 10) || 1);
    }
    salvarSessao();
    aplicarFiltros();
  }

  function selecionarMenoresPrecos() {
    if (!listaItens.length || !listaPrecos.length) {
      alert('Aguarde os dados serem carregados.');
      return;
    }

    let itensAlterados = 0;

    listaItens.forEach(item => {
      const obrigatoriedade = obterPropriedade(item, ['Obrigatoriedade', 'Obrigatorio', 'Tipo', 'Status']);
      const isObrigatorio = obrigatoriedade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === 'item obrigatorio';
      if (!isObrigatorio) return;

      const id = obterPropriedade(item, ['ID_Item', 'ID', 'Codigo']);
      const nome = obterPropriedade(item, ['Item', 'Nome_Item', 'Nome', 'Descricao']) || 'Item sem nome';
      const qtdPadrao = parseInt(obterPropriedade(item, ['Qtd_Padrao', 'Qtd', 'Quantidade'])) || 1;
      const chaveItem = id || nome;

      const ofertas = listaPrecos.filter(preco => {
        const precoId = obterPropriedade(preco, ['ID_Item', 'ID', 'Codigo']);
        const precoItem = obterPropriedade(preco, ['Item', 'Nome_Item', 'Nome']);
        return (id && precoId && precoId.toLowerCase() === id.toLowerCase()) || 
               (nome && precoItem && precoItem.toLowerCase() === nome.toLowerCase());
      });

      if (!ofertas.length) return;

      let menorIndex = -1;
      let menorPreco = Infinity;

      ofertas.forEach((oferta, idx) => {
        const precoUnit = converterPreco(obterPropriedade(oferta, ['Preco', 'Valor']));
        if (precoUnit > 0 && precoUnit < menorPreco) {
          menorPreco = precoUnit;
          menorIndex = idx;
        }
      });

      if (menorIndex !== -1) {
        const ofertaEscolhida = ofertas[menorIndex];
        const nomeLoja = obterPropriedade(ofertaEscolhida, ['Nome_Loja', 'Loja']);
        const marca = obterPropriedade(ofertaEscolhida, ['Marca_Vendida', 'Marca', 'Modelo']);
        const imagem = obterPropriedade(item, ['URL_Imagem', 'Imagem', 'Foto']);
        const qtdAtual = selecoesUsuario[chaveItem] ? selecoesUsuario[chaveItem].qtd : qtdPadrao;

        selecoesUsuario[chaveItem] = {
          ofertaIndex: String(menorIndex),
          qtd: qtdAtual,
          preco: menorPreco,
          link: obterPropriedade(ofertaEscolhida, ['Link', 'URL']),
          cupom: obterPropriedade(ofertaEscolhida, ['Cupom', 'CUPOM', 'Cod_Cupom']),
          nome: nome,
          img: imagem || 'https://placehold.co/400x250/151d30/94a3b8?text=Sem+Foto',
          lojaLabel: nomeLoja + (marca ? ' (' + marca + ')' : '')
        };
        itensAlterados++;
      }
    });

    if (itensAlterados > 0) {
      salvarSessao();
      aplicarFiltros();
      toggleSidebar(true);
    } else {
      alert('Nenhum item obrigatório com oferta válida foi encontrado.');
    }
  }

  function gerarPDF() {
    const itensAtivos = Object.entries(selecoesUsuario).filter(([_, v]) => v.ofertaIndex !== '' && v.preco > 0);
    if (!itensAtivos.length) {
      alert('Selecione ao menos um equipamento para gerar o relatório.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const dataAtual = new Date();
    const dataStr = dataAtual.toLocaleDateString('pt-BR');
    const horaStr = dataAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 26, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(config.tituloCurso, 14, 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(config.subtituloCurso, 14, 17);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Cotação emitida em: ${dataStr} às ${horaStr}`, 14, 22);

    let totalGeral = 0;
    const listaLinks = [];
    const linhasTabela = itensAtivos.map(([_, item], index) => {
      const subtotal = item.preco * item.qtd;
      totalGeral += subtotal;
      listaLinks.push(item.link || '');
      return [
        (index + 1).toString(),
        item.nome,
        item.lojaLabel || 'Não informada',
        item.link ? ' ' : '-',
        item.qtd.toString(),
        `R$ ${item.preco.toFixed(2).replace('.', ',')}`,
        `R$ ${subtotal.toFixed(2).replace('.', ',')}`
      ];
    });

    linhasTabela.push([
      { content: 'TOTAL ESTIMADO', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
      { content: `R$ ${totalGeral.toFixed(2).replace('.', ',')}`, styles: { fontStyle: 'bold', textColor: [5, 150, 105], fillColor: [241, 245, 249] } }
    ]);

    doc.autoTable({
      startY: 32,
      head: [['#', 'Item / Equipamento', 'Fornecedor / Oferta', 'Link', 'Qtd', 'Unitário', 'Subtotal']],
      body: linhasTabela,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold', halign: 'left' },
      styles: { fontSize: 8, cellPadding: 2.5, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 56 },
        2: { cellWidth: 44 },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 20, halign: 'right' },
        6: { cellWidth: 24, halign: 'right' }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawCell: data => {
        if (data.section === 'body' && data.column.index === 3 && data.row.index < listaLinks.length) {
          const url = listaLinks[data.row.index];
          if (url) {
            const btnLargura = 15;
            const btnAltura = 4.8;
            const btnX = data.cell.x + (data.cell.width - btnLargura) / 2;
            const btnY = data.cell.y + (data.cell.height - btnAltura) / 2;

            doc.setFillColor(37, 99, 235);
            doc.roundedRect(btnX, btnY, btnLargura, btnAltura, 1, 1, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.5);
            doc.setTextColor(255, 255, 255);
            doc.text('VER ITEM', btnX + (btnLargura / 2), btnY + 3.3, { align: 'center' });
            doc.link(btnX, btnY, btnLargura, btnAltura, { url: url });
          }
        }
      },
      didDrawPage: data => {
        const totalPaginas = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Página ${data.pageNumber} de ${totalPaginas} • Sistema de Enxovais PMDF`, 14, doc.internal.pageSize.height - 10);
      }
    });

    doc.save(`${config.nomeArquivoPdf}_${dataStr.replace(/\//g, '-')}.pdf`);
  }

  // Inicializador que recebe as configurações de cada página
  async function iniciar(opcoes) {
    aplicarSeguranca();
    config = Object.assign(config, opcoes);
    carregarSessao();

    const stats = document.getElementById('statsContador');
    if (stats) stats.innerText = 'Carregando itens...';

    try {
      const [precos, itens] = await Promise.all([
        carregarCSV(config.urlPrecos),
        carregarCSV(config.urlItens)
      ]);
      listaPrecos = precos;
      listaItens = itens;
      preencherFiltroFases();
      aplicarFiltros();
    } catch (erro) {
      const grid = document.getElementById('gridItens');
      if (grid) grid.innerHTML = `<p style="color:var(--text-muted);padding:1rem;">Erro ao carregar dados: ${erro.message}</p>`;
    }
  }

  // Métodos expostos globalmente para o HTML interagir
  return {
    iniciar,
    aplicarFiltros,
    atualizarOferta,
    atualizarQtd,
    selecionarMenoresPrecos,
    toggleSidebar,
    gerarPDF
  };
})();

// Expõe também as funções diretas no window para manter compatibilidade com botões inline legados
window.toggleSidebar = AppEnxoval.toggleSidebar;
window.aplicarFiltros = AppEnxoval.aplicarFiltros;
window.selecionarMenoresPrecos = AppEnxoval.selecionarMenoresPrecos;
window.gerarPDF = AppEnxoval.gerarPDF;
