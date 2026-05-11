/* ══════════════════════════════════════════
   CONFIGURAÇÃO — URLs do Google Sheets
   Publicar cada aba: Arquivo → Publicar na web → CSV
══════════════════════════════════════════ */
const BASE_EZ   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTj3u5RIJkXWM4DJP_vYx5VjJMC_PpHdk6C62daBJJE0hk1NJhB86UdahFIDB7AEUxZiJ5OEiVu5c_u/pub?single=true&output=csv&gid=';
const BASE_PERF = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT-tsnKujVragUXmIRfSossYDc4jhVWsbOj3iSJ9b_ak2gyaL1wcK5kEDLzI_w9rslpdb55odtM3qoX/pub?single=true&output=csv&gid=';

const SHEETS = {
  SEMANAL:    BASE_PERF + '0',       // nova planilha de performance
  EZ_TICKETS: BASE_EZ   + '351627180',
  METAS:      BASE_EZ   + '956110426'
};

/* ── DADOS EM MEMÓRIA ── */
let SEMANAL_RAW  = {};
let EZ_TICKETS   = [];
let METAS_RAW    = [];

const SC = {green:'#1E7A42', yellow:'#966A00', red:'#B82418', gray:'#9BA8B0'};
let SEM = [];

/* ── PARSER CSV GENÉRICO ── */
function parseCSV(text, sep=',') {
  const lines = text.trim().split(/\r?\n/);
  const start = lines[0].startsWith('sep=') ? 1 : 0;
  const headers = lines[start].split(sep).map(h => h.replace(/^"|"$/g,'').trim());
  return lines.slice(start+1).filter(l=>l.trim()).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (let c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === sep && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h,i) => { obj[h] = vals[i] !== undefined ? vals[i].replace(/^"|"$/g,'') : ''; });
    return obj;
  });
}

/* ── PARSER NUMÉRICO pt-BR ── */
function parseNum(s) {
  if (s === null || s === undefined) return 0;
  s = String(s).trim().replace(/^R\$\s*/, '').replace(/%\s*$/, '').replace(/\s/g,'');
  if (!s) return 0;
  // Remover pontos de milhar (ponto seguido de exatamente 3 dígitos)
  s = s.replace(/\.(?=\d{3}(\D|$))/g, '');
  // Vírgula decimal → ponto
  s = s.replace(',', '.');
  return parseFloat(s) || 0;
}

/* ── PARSER SEMANAL ── */
function parseSemanal(text) {
  const lines = text.trim().split(/\r?\n/);

  // Detectar sep= e calcular skip exato
  let skip = 0;
  if (lines[0] && lines[0].startsWith('sep=')) skip = 1;
  // Após sep (ou início): linha vazia, título, cabeçalho-meses, cabeçalho-semanas = +4
  skip += 4;

  const dataLines = lines.slice(skip).filter(l => l.trim());
  const result = {};
  let currentInd = '';
  const TIPO_MAP = { 'Meta':'meta', 'Resultado':'res', 'Ano anterior':'anoAnt' };

  dataLines.forEach(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (let c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { vals.push(cur.trim().replace(/^"|"$/g,'')); cur = ''; }
      else { cur += c; }
    }
    vals.push(cur.trim().replace(/^"|"$/g,''));

    const col0 = vals[0] ? vals[0].trim() : '';
    const col1 = vals[1] ? vals[1].trim() : '';

    if (col0) currentInd = col0;
    if (!currentInd) return;

    const tipo = TIPO_MAP[col1];
    if (!tipo) return;

    if (!result[currentInd]) result[currentInd] = {};
    for (let mes = 1; mes <= 12; mes++) {
      if (!result[currentInd][mes]) result[currentInd][mes] = {};
      for (let sem = 1; sem <= 4; sem++) {
        const col = 2 + (mes-1)*4 + (sem-1);
        if (!result[currentInd][mes][sem]) result[currentInd][mes][sem] = {meta:0, res:0, anoAnt:0};
        if (col < vals.length) {
          const v = parseNum(vals[col] || '');
          result[currentInd][mes][sem][tipo] = v;
        }
      }
    }
  });

  console.log('[Semanal] indicadores:', Object.keys(result));
  if (Object.keys(result).length > 0) {
    const s = Object.keys(result)[0];
    console.log('[Semanal] ex:', s, '| mes3 S1:', result[s]?.[3]?.[1]);
  }
  return result;
}

/* ── FILTRO: semanas por mês+semana ── */
function getWeeksForFilter(mes, sem) {
  if (!sem || sem === 0) return [1,2,3,4].map(s => ({mes, sem: s}));
  return [{mes, sem}];
}

/* ── FILTRO: range de datas para EZ tickets ── */
function getDateRangeForFilter(mes, sem) {
  const year = new Date().getFullYear();
  const pad  = n => String(n).padStart(2,'0');
  const last = new Date(year, mes, 0).getDate();
  if (!sem || sem === 0) return { de: `${year}-${pad(mes)}-01`, ate: `${year}-${pad(mes)}-${pad(last)}` };
  const dayStart = (sem-1)*7 + 1;
  const dayEnd   = sem === 4 ? last : sem*7;
  return { de: `${year}-${pad(mes)}-${pad(dayStart)}`, ate: `${year}-${pad(mes)}-${pad(dayEnd)}` };
}

/* ── SOMA SEMANAL ── */
function sumSemanal(indicador, weeks) {
  let meta = 0, res = 0, anoAnt = 0;
  weeks.forEach(({mes, sem}) => {
    const d = SEMANAL_RAW[indicador]?.[mes]?.[sem];
    if (d) {
      meta   += d.meta   || 0;
      res    += d.res    || 0;
      // Só conta anoAnt se houver resultado em 2026 — evita comparação assimétrica
      // em meses parciais (ex: Abril com só S1/S2 preenchido)
      if (d.res > 0) anoAnt += d.anoAnt || 0;
    }
  });
  return {meta, res, anoAnt};
}

/* ── PARSER EZ TICKETS ── */
const EZ_EXCLUIR = ['Mirian']; // agentes excluídos de todos os cálculos
function processEZTickets(rows) {
  return rows.map(r => {
    const d = r['Data'] || '';
    let dataStr = '';
    if (d) {
      const [dia, mes, ano] = d.split('/');
      dataStr = `${ano}-${(mes||'').padStart(2,'0')}-${(dia||'').padStart(2,'0')}`;
    }
    return {
      DataStr: dataStr,
      Hora: parseInt(r['Hora']) || 0,
      Agente: r['Agente'] || '',
      Status: r['Status'] || '',
      Finalizado: r['Finalizado'] === '1' || r['Finalizado'] === 1,
      TPI_min: parseFloat(r['TPI_min']) || 0,
      TMA_min: parseFloat(r['TMA_min']) || 0,
      Classificacao: r['Classificacao_Principal'] || '',
      Ativo: r['Ativo'] || '',
      CSAT: (r['Avaliação_CSAT'] || r['Avaliacao_CSAT'] || '').trim(),
      RespostaCSAT: (r['Resposta_Aberta+ CSAT'] || r['Resposta_Aberta+_CSAT'] || r['RespostaAberta'] || '').trim()
    };
  }).filter(r => r.DataStr && !EZ_EXCLUIR.includes(r.Agente));
}



/* ── LOADING ── */
function setLoading(on) {
  const msg = document.getElementById('loading-msg');
  if (msg) msg.style.display = on ? 'flex' : 'none';
}

/* ── CARREGAMENTO PRINCIPAL ── */

/* ── PARSER ABA METAS ── */
// Estrutura: Agente | Indicador | Janeiro Meta | Janeiro Real | Fevereiro Meta | Fevereiro Real | ...
function processMetasSheet(rows) {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const result = [];
  rows.forEach(r => {
    const agente    = (r['Agente']    || '').trim();
    const indicador = (r['Indicador'] || '').trim();
    if (!agente || !indicador || agente === 'Agente') return;
    MESES.forEach((m, i) => {
      const mes  = i + 1;
      const meta = parseNum(r[m + ' Meta'] || '0');
      const real = parseNum(r[m + ' Real'] || '0');
      result.push({ agente, indicador, mes, meta, real });
    });
  });
  console.log('[Metas] registros:', result.length, '| agentes:', [...new Set(result.map(d=>d.agente))]);
  return result;
}

/* ── HELPER: filtrar METAS_RAW ── */
function getMetasData(mes) {
  return METAS_RAW.filter(d => d.mes === mes);
}


/* ══ RENDER ABA METAS ══ */
let metasRendered = false;
function renderMetas() {
  // Sempre re-renderiza ao trocar mês
  const el = document.getElementById('metas-main');
  if (!el) return;

  const mesRawM  = parseInt(document.getElementById('f-mes')?.value);
  const mes      = mesRawM || (new Date().getMonth()+1);
  const triSelM  = parseInt(document.getElementById('f-tri')?.value) || 0;
  const TRI_MAP  = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] };
  const TRI_NOMES = { 1:'Q1 · Jan–Mar', 2:'Q2 · Abr–Jun', 3:'Q3 · Jul–Set', 4:'Q4 · Out–Dez' };

  // Determinar quais meses acumular
  let mesesAtivos;
  if (mesRawM === 0) {
    mesesAtivos = [1,2,3,4,5,6,7,8,9,10,11,12]; // ano completo
  } else if (triSelM && TRI_MAP[triSelM]) {
    mesesAtivos = TRI_MAP[triSelM]; // trimestre
  } else {
    mesesAtivos = [mes]; // mês único
  }

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = mesRawM === 0 ? 'Ano Completo'
                : triSelM ? TRI_NOMES[triSelM]
                : MESES[mes-1];

  // Se não há dados ainda → skeleton de espera
  if (!METAS_RAW.length) {
    el.innerHTML = `
    <div style="padding:48px 32px;text-align:center;">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:700;
        color:var(--gold);letter-spacing:1px;margin-bottom:12px;">METAS</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:14px;color:var(--txt-faint);
        letter-spacing:1px;margin-bottom:32px;">Conecte a planilha de metas para visualizar os dados</div>
      <div style="display:inline-block;padding:12px 24px;border:1px solid rgba(180,165,140,0.3);
        border-radius:6px;font-family:'Barlow Condensed',sans-serif;font-size:13px;
        color:var(--txt-faint);letter-spacing:1px;">
        Cole o link CSV em <strong style="color:var(--gold);">SHEETS.METAS</strong> no script.js
      </div>
    </div>`;
    return;
  }

  // Acumular meta e real de todos os meses ativos
  const dadosBase = METAS_RAW.filter(d => mesesAtivos.includes(d.mes));
  const dadosMap = {};
  dadosBase.forEach(d => {
    const key = d.agente + '|' + d.indicador;
    if (!dadosMap[key]) dadosMap[key] = { agente: d.agente, indicador: d.indicador, mes: mes, meta: 0, real: 0 };
    dadosMap[key].meta += d.meta;
    dadosMap[key].real += d.real;
  });
  const dados = Object.values(dadosMap);
  const indicadores = [...new Set(dados.map(d => d.indicador))];
  // Exibir só agentes com pelo menos uma meta > 0 no mês selecionado
  const agentes = [...new Set(dados.filter(d => d.agente !== 'Time').map(d => d.agente))]
    .filter(ag => dados.some(d => d.agente === ag && d.meta > 0));
  const timeRow     = (ind) => dados.find(d => d.agente === 'Time' && d.indicador === ind) || {meta:0,real:0};

  const SC = {green:'#1E7A42', yellow:'#966A00', red:'#B82418', gray:'#9BA8B0'};
  function cor(real, meta) {
    if (!meta) return SC.gray;
    const p = real/meta*100;
    return p >= 100 ? SC.green : p >= 70 ? SC.yellow : SC.red;
  }
  function badge(real, meta) {
    if (!meta) return '—';
    return Math.round(real/meta*100) + '%';
  }
  function fmtV(ind, v) {
    if (ind === 'Faturamento' || ind === 'Receita') return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    if (ind === 'Litros' || ind === 'Litros vendidos') return Math.round(v).toLocaleString('pt-BR') + ' L';
    if (ind === 'Conversão') return v.toFixed(1) + '%';
    return Math.round(v).toLocaleString('pt-BR');
  }

  // ── Seção 1: Time ──
  let teamHTML = indicadores.map(ind => {
    const t   = timeRow(ind);
    const pct = t.meta ? Math.min(t.real/t.meta*100, 100) : 0;
    const c   = cor(t.real, t.meta);
    const bg  = c === SC.green ? 'rgba(30,122,66,0.12)' : c === SC.yellow ? 'rgba(150,106,0,0.12)' : 'rgba(184,36,24,0.10)';
    return `
    <div class="card line-l2" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header">
          <div class="c-title pill-l2">${ind}</div>
          <div class="c-sub">${nomeMes} · Time</div>
        </div>
        <div style="margin-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:700;color:var(--txt);">${fmtV(ind, t.real)}</div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;color:${c};">${badge(t.real,t.meta)}</div>
          </div>
          <div style="height:6px;background:rgba(180,165,140,0.15);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct.toFixed(1)}%;background:${c};border-radius:3px;transition:width 0.8s ease;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:5px;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--txt-faint);">meta: ${fmtV(ind, t.meta)}</span>
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--txt-faint);">${t.real >= t.meta ? '✓ atingida' : 'falta ' + fmtV(ind, Math.max(0, t.meta - t.real))}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Seção 2: Agentes ──
  let agentesHTML = agentes.map(ag => {
    const rows = dados.filter(d => d.agente === ag);
    const cards = rows.map(r => {
      const pct = r.meta ? Math.min(r.real/r.meta*100,100) : 0;
      const c   = cor(r.real, r.meta);
      return `
        <div style="margin-bottom:14px;">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;
            letter-spacing:0.8px;color:var(--txt-faint);text-transform:uppercase;margin-bottom:4px;">${r.indicador}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;height:8px;background:rgba(180,165,140,0.15);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${pct.toFixed(1)}%;background:${c};border-radius:4px;transition:width 0.8s ease;"></div>
            </div>
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;
              color:${c};min-width:38px;text-align:right;">${badge(r.real,r.meta)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:3px;">
            <span style="font-family:'Barlow Condensed',sans-serif;font-size:10px;color:var(--txt-faint);">${fmtV(r.indicador,r.real)} de ${fmtV(r.indicador,r.meta)}</span>
          </div>
        </div>`;
    }).join('');

    // Calcular % médio do agente para ranking
    const medPct = rows.reduce((s,r) => s + (r.meta ? r.real/r.meta*100 : 0), 0) / Math.max(rows.length, 1);
    const cAg    = cor(medPct, 100);

    return `
    <div class="card line-l3" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header">
          <div class="c-title pill-l3">${ag}</div>
          <div class="c-sub" style="color:${cAg};font-weight:600;">${Math.round(medPct)}% da meta</div>
        </div>
        <div style="margin-top:14px;">${cards}</div>
      </div>
    </div>`;
  }).join('');

  // ── Seção 3: Ranking ──
  const ranking = agentes.map(ag => {
    const rows  = dados.filter(d => d.agente === ag);
    const med   = rows.reduce((s,r) => s + (r.meta ? r.real/r.meta*100 : 0), 0) / Math.max(rows.length,1);
    return { ag, med };
  }).sort((a,b) => b.med - a.med);

  const medals = ['🥇','🥈','🥉'];
  const rankHTML = ranking.map((r,i) => {
    const c   = cor(r.med, 100);
    const bar = Math.min(r.med, 100).toFixed(1);
    return `
    <div style="display:flex;align-items:center;gap:14px;padding:10px 0;
      border-bottom:1px solid rgba(180,165,140,0.12);">
      <div style="font-size:20px;width:28px;text-align:center;">${medals[i]||''}</div>
      <div style="flex:1;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;
          color:var(--txt);">${r.ag}</div>
        <div style="height:5px;background:rgba(180,165,140,0.15);border-radius:3px;margin-top:4px;overflow:hidden;">
          <div style="height:100%;width:${bar}%;background:${c};border-radius:3px;"></div>
        </div>
      </div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;
        color:${c};min-width:48px;text-align:right;">${Math.round(r.med)}%</div>
    </div>`;
  }).join('');

  // ── Consolidado do Time ──
  const totalMeta  = indicadores.map(ind => timeRow(ind).meta).reduce((a,b)=>a+b,0);
  const totalReal  = indicadores.map(ind => timeRow(ind).real).reduce((a,b)=>a+b,0);
  const mediaGeral = indicadores.reduce((sum, ind) => {
    const t = timeRow(ind);
    return sum + (t.meta ? t.real/t.meta*100 : 0);
  }, 0) / Math.max(indicadores.length, 1);

  const cGeral = mediaGeral >= 100 ? SC.green : mediaGeral >= 70 ? SC.yellow : SC.red;
  const bgGeral = mediaGeral >= 100 ? 'rgba(30,122,66,0.10)' : mediaGeral >= 70 ? 'rgba(150,106,0,0.10)' : 'rgba(184,36,24,0.08)';

  const faltaItems = indicadores.map(ind => {
    const t = timeRow(ind);
    const falta = Math.max(0, t.meta - t.real);
    if (!falta || !t.meta) return null;
    return fmtV(ind, falta) + ' de ' + ind.toLowerCase();
  }).filter(Boolean);

  const destaqueAg = ranking[0];
  const destaqueHTML = destaqueAg ? `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(180,165,140,0.12);">
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:0.8px;
        color:var(--txt-faint);text-transform:uppercase;margin-bottom:6px;">Destaque do mês</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:22px;">🏆</span>
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;
            color:var(--txt);">${destaqueAg.ag}</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;color:var(--txt-faint);">
            ${Math.round(destaqueAg.med)}% de atingimento médio em ${nomeMes}
          </div>
        </div>
      </div>
    </div>` : '';

  const consolidadoHTML = `
  <div class="row" style="grid-template-columns:1fr;">
    <div class="card line-l3" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:20px;">
        <div class="c-header">
          <div class="c-title pill-l3">Consolidado do Time · ${nomeMes}</div>
          <div class="c-sub">Visão geral de atingimento — média de todos os indicadores</div>
        </div>
        <div style="margin-top:18px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:42px;font-weight:700;
              color:${cGeral};">${Math.round(mediaGeral)}%</div>
            <div style="font-family:'Barlow Condensed',sans-serif;font-size:13px;color:var(--txt-faint);">
              da meta geral atingida
            </div>
          </div>
          <div style="height:10px;background:rgba(180,165,140,0.12);border-radius:5px;overflow:hidden;margin-bottom:10px;">
            <div style="height:100%;width:${Math.min(mediaGeral,100).toFixed(1)}%;background:${cGeral};
              border-radius:5px;transition:width 0.9s ease;"></div>
          </div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;color:var(--txt-faint);">
            ${faltaItems.length ? 'Ainda falta: ' + faltaItems.join(' · ') : '✓ Todas as metas atingidas!'}
          </div>
          ${destaqueHTML}
        </div>
      </div>
    </div>
  </div>`;

  el.innerHTML = `
  <!-- METAS TEAM -->
  <div class="row" style="grid-template-columns:repeat(${Math.min(indicadores.length,3)},1fr);">
    ${teamHTML}
  </div>

  <!-- METAS INDIVIDUAIS + RANKING -->
  <div class="row" style="grid-template-columns:${agentes.length > 0 ? '2fr 1fr' : '1fr'};">
    <div style="display:grid;grid-template-columns:repeat(${Math.min(agentes.length,3)},1fr);gap:16px;">
      ${agentesHTML}
    </div>
    <div class="card line-l3" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header">
          <div class="c-title pill-l3">Ranking ${nomeMes}</div>
          <div class="c-sub">% médio de atingimento</div>
        </div>
        <div style="margin-top:12px;">${rankHTML}</div>
      </div>
    </div>
  </div>

  <!-- CONSOLIDADO -->
  ${consolidadoHTML}`;
}


/* ══ DARK MODE ══ */
(function(){
  const DARK_KEY = 'germania-dark';
  const root = document.documentElement;

  function collapsePageWrap() {
    const pw = document.querySelector('.page-wrap');
    if (!pw) return;
    if (root.getAttribute('data-theme') === 'dark') {
      pw.style.minHeight = '0';
      pw.style.paddingBottom = '0';
    } else {
      pw.style.minHeight = '';
      pw.style.paddingBottom = '';
    }
  }
  window._collapsePageWrap = collapsePageWrap;

  function applyDark(on) {
    root.setAttribute('data-theme', on ? 'dark' : 'light');
    const lbl = document.getElementById('btn-dark');
    if (lbl) lbl.textContent = on ? 'Modo claro' : 'Modo escuro';
    try { localStorage.setItem(DARK_KEY, on ? '1' : '0'); } catch(e){}
    collapsePageWrap();
  }

  window.toggleDark = function() {
    const isDark = root.getAttribute('data-theme') === 'dark';
    applyDark(!isDark);
  };

  // Inicializar
  const saved = (() => { try { return localStorage.getItem(DARK_KEY); } catch(e){ return null; } })();
  applyDark(saved === '1');
  window.addEventListener('load', collapsePageWrap);
})();


/* ── HELPER CSAT ── */
function calcCSAT(tickets) {
  const SATISFEITOS    = ['total. satisfeito', 'satisfeito'];
  const INSATISFEITOS  = ['insatisfeito', 'total. insatisfeito'];
  const avaliados = tickets.filter(t => t.CSAT);
  const total     = avaliados.length;
  const sat  = avaliados.filter(t => SATISFEITOS.includes(t.CSAT.toLowerCase())).length;
  const insat = avaliados.filter(t => INSATISFEITOS.includes(t.CSAT.toLowerCase())).length;
  return {
    total,
    pctSat:   total ? Math.round(sat   / total * 100) : null,
    pctInsat: total ? Math.round(insat / total * 100) : null,
  };
}

async function loadData() {
  setLoading(true);
  try {
    await Promise.all([
      fetch(SHEETS.SEMANAL).then(r=>r.text()).then(t=>{ SEMANAL_RAW = parseSemanal(t); }),
      fetch(SHEETS.EZ_TICKETS).then(r=>r.text()).then(t=>{ EZ_TICKETS = processEZTickets(parseCSV(t)); }),
      fetch(SHEETS.METAS).then(r=>r.text()).then(t=>{ METAS_RAW = processMetasSheet(parseCSV(t)); }),
    ]);
  } catch(e) { console.warn('Erro ao carregar dados:', e); }
  console.log('[EZ_TICKETS]', EZ_TICKETS.length, 'tickets | meses:', [...new Set(EZ_TICKETS.map(d=>d.DataStr.slice(0,7)))]);
  setLoading(false);
  go();
}

/* ── UTILITÁRIOS VISUAIS ── */
const CR=34,CCX=46,CCY=46,CSZ=92,CCIRC=2*Math.PI*CR;
function circ(elId,pct,color,txt){
  const el=document.getElementById(elId);if(!el)return;
  const cp=Math.min(Math.max(pct||0,0),100),off=CCIRC-(cp/100)*CCIRC;
  const uid='g'+elId;
  const cLight=color==='#9BA8B0'?'#D0D8DC':color==='#1E7A42'?'#6FD49A':color==='#966A00'?'#F5C050':color==='#B82418'?'#F08878':'#CCCCCC';
  el.innerHTML=`<svg width="${CSZ}" height="${CSZ}" viewBox="0 0 ${CSZ} ${CSZ}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${cLight}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="1"/>
      </linearGradient>
      <filter id="${uid}sh">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.15)"/>
      </filter>
    </defs>
    <circle cx="${CCX}" cy="${CCY}" r="${CR+7}" fill="rgba(0,0,0,0.07)"/>
    <circle cx="${CCX}" cy="${CCY}" r="${CR+5}" class="circ-bg-fill" fill="white" filter="url(#${uid}sh)"/>
    <circle cx="${CCX}" cy="${CCY}" r="${CR}" fill="none" stroke="rgba(180,165,140,0.20)" stroke-width="8"/>
    <circle cx="${CCX}" cy="${CCY}" r="${CR}" fill="none"
      stroke="url(#${uid})" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${CCIRC.toFixed(2)}" stroke-dashoffset="${CCIRC.toFixed(2)}"
      transform="rotate(-90 ${CCX} ${CCY})"
      style="transition:stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1);"/>
    <text x="${CCX}" y="${CCY+5}"
      font-family="Barlow Condensed,sans-serif" font-size="13" font-weight="400"
      text-anchor="middle" fill="${color}">${txt}</text>
  </svg>`;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const f=el.querySelector('circle[transform]');
    if(f)f.style.strokeDashoffset=off.toFixed(2);
  }));
}

function st(r,m){if(!m)return'gray';const p=(r/m)*100;return p>=100?'green':p>=70?'yellow':'red';}
function pl(r,m){return m?Math.round((r/m)*100)+'%':'—';}
function setS(id,s){const c=document.getElementById(id);if(c&&!c.classList.contains('line-l1')&&!c.classList.contains('line-l2'))c.setAttribute('data-s',s);}
function setTip(id,t){const c=document.getElementById(id);if(c)c.textContent=t;}
function hkpi(bId,vId,tId,val,mr,fn){
  const b=document.getElementById(bId),v=document.getElementById(vId);
  if(!v||!b)return;
  v.innerHTML=fn(val);
  const barId=bId.replace('hk-','hb-');
  const bar=document.getElementById(barId);
  if(bar&&mr){
    const pct=Math.min((val/mr)*100,100);
    const s=pct>=100?'green':pct>=70?'yellow':'red';
    bar.className='hk-bar '+s;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.width=pct.toFixed(1)+'%';}));
    const pctEl=document.getElementById(barId.replace('hb-','hp-'));
    if(pctEl)pctEl.textContent=pct.toFixed(0)+'%';
  }
  b.className='hk neu';
}
function dias(de,ate){return Math.max(1,Math.round((new Date(ate)-new Date(de))/864e5)+1);}
function fmt(n){return n.toLocaleString('pt-BR');}
function fR(n){return'R$'+Math.round(n).toLocaleString('pt-BR');}
function fL(n){return Math.round(n)+'L';}

/* ── SPARKLINE ── */
function spark(id,vals,labs,fmtFn,highlightIdx=-1){
  const wrap=document.getElementById(id);if(!wrap)return;
  wrap.innerHTML='';
  const W=wrap.offsetWidth||220,H=wrap.offsetHeight||120;
  const pL=8,pR=12,pT=20,pB=20,uW=W-pL-pR,uH=H-pT-pB,n=vals.length;
  const valid=vals.filter(v=>v>0);if(!valid.length)return;
  const mn=Math.min(...valid)*0.88,mx=Math.max(...valid)*1.08,rng=mx-mn||1;
  const xs=vals.map((_,i)=>pL+(i/(n-1))*uW);
  const ys=vals.map(v=>pT+uH-((v-mn)/rng)*uH);
  const pts=xs.map((x,i)=>`${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area=`M${xs[0].toFixed(1)},${ys[0].toFixed(1)} ${xs.map((x,i)=>`L${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')} L${xs[n-1].toFixed(1)},${(H-pB).toFixed(1)} L${xs[0].toFixed(1)},${(H-pB).toFixed(1)} Z`;
  const dotColors=vals.map((v,i)=>i===0?'#9BA8B0':v>=vals[i-1]?'#1E7A42':'#B82418');
  const vLbls=vals.map((v,i)=>{
    const a=i===0?'start':i===n-1?'end':'middle';
    return `<text x="${xs[i].toFixed(1)}" y="${(ys[i]-7).toFixed(1)}" text-anchor="${a}"
      font-family="Barlow Condensed,sans-serif" font-size="11" font-weight="600"
      fill="${dotColors[i]}">${fmtFn(v)}</text>`;
  }).join('');
  const sLbls=labs.map((l,i)=>{
    const a=i===0?'start':i===n-1?'end':'middle';
    return `<text x="${xs[i].toFixed(1)}" y="${(H-4).toFixed(1)}" text-anchor="${a}"
      font-family="Barlow Condensed,sans-serif" font-size="10" font-weight="400"
      fill="#A89870">${l}</text>`;
  }).join('');
  const dots=vals.map((v,i)=>{
    const isHL=highlightIdx>=0&&i===highlightIdx;
    const r=isHL?7:4;
    const stroke=isHL?'#FFA62C':'white';
    const sw=isHL?2.5:2;
    const op=highlightIdx>=0&&!isHL?'0.35':'1';
    return `<circle class="sd"
      cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${r}" fill="${dotColors[i]}"
      stroke="${stroke}" stroke-width="${sw}" opacity="${op}"
      style="cursor:pointer;transition:r 0.15s;"
      data-v="${fmtFn(v)}" data-l="${labs[i]}"/>`;
  }).join('');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('width','100%');svg.setAttribute('height','100%');
  svg.style.display='block';
  svg.innerHTML=`<path d="${area}" fill="rgba(180,160,120,0.08)"/>
    <polyline points="${pts}" fill="none" stroke="#C4B89A" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${vLbls}${dots}${sLbls}`;
  const oldTip=document.querySelector('.sp-tip[data-id="'+id+'"]');
  if(oldTip)oldTip.remove();
  const tip=document.createElement('div');
  tip.className='sp-tip';tip.dataset.id=id;
  wrap.style.position='relative';
  document.body.appendChild(tip);wrap.appendChild(svg);
  svg.querySelectorAll('.sd').forEach(d=>{
    d.addEventListener('mouseenter',(e)=>{
      d.setAttribute('r','6');
      tip.textContent=d.dataset.l+': '+d.dataset.v;
      tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-32)+'px';tip.style.opacity='1';
    });
    d.addEventListener('mousemove',(e)=>{ tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-32)+'px'; });
    d.addEventListener('mouseleave',()=>{d.setAttribute('r','4');tip.style.opacity='0';});
  });
}

/* ── VISÃO GERAL ── */
function go(){
  const mesRaw = parseInt(document.getElementById('f-mes')?.value);
  const mes   = mesRaw || (new Date().getMonth()+1);
  const sem   = parseInt(document.getElementById('f-sem')?.value) || 0;
  const tri   = parseInt(document.getElementById('f-tri')?.value) || 0;

  // Acumular semanas: ano completo (mes=0), trimestre, ou normal
  const TRI_MESES = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] };
  let weeks;
  if (mesRaw === 0) {
    // Todos os meses do ano
    weeks = [];
    [1,2,3,4,5,6,7,8,9,10,11,12].forEach(m => [1,2,3,4].forEach(s => weeks.push({mes:m, sem:s})));
  } else if (tri && TRI_MESES[tri]) {
    weeks = [];
    TRI_MESES[tri].forEach(m => [1,2,3,4].forEach(s => weeks.push({mes:m, sem:s})));
  } else {
    weeks = getWeeksForFilter(mes, sem);
  }

  const alc = sumSemanal('Alcance', weeks);
  const at  = sumSemanal('Engajamento / Atendimento', weeks);
  const orc = sumSemanal('Orçamentos', weeks);
  const ped = sumSemanal('Pedidos', weeks);
  const lit = sumSemanal('Litros vendidos', weeks);
  const fat = sumSemanal('Faturamento', weeks);

  const tAlc=alc.res,mrAlc=alc.meta;
  // Atendimentos: usar count real do EZ_TICKETS (fonte mais confiável)
  const {de: ezDe, ate: ezAte} = mesRaw === 0
    ? { de: `${new Date().getFullYear()}-01-01`, ate: `${new Date().getFullYear()}-12-31` }
    : getDateRangeForFilter(mes, sem);
  const ezMesFilter = tri && TRI_MESES[tri] ? TRI_MESES[tri] : null;
  const ezCount = EZ_TICKETS.filter(d => {
    if (ezMesFilter) {
      const m = parseInt(d.DataStr.slice(5,7));
      return ezMesFilter.includes(m);
    }
    return (!ezDe || d.DataStr >= ezDe) && (!ezAte || d.DataStr <= ezAte);
  }).length;
  const tAt = ezCount || at.res;  // fallback para planilha se EZ vazio
  const mrAt=at.meta;
  const tOrc=orc.res,mrO=orc.meta;
  const tPed=ped.res,mrP=ped.meta;
  const tLit=lit.res,mrL=lit.meta;
  const tRec=fat.res,mrR=fat.meta;

  const tmP=tPed?tRec/tPed:0, tmL=tPed?tLit/tPed:0, rL=tLit?tRec/tLit:0;
  const nSem=weeks.length||1;
  const aL=tLit/nSem, aR=tRec/nSem;
  const sAlc=st(tAlc,mrAlc),sAt=st(tAt,mrAt);
  const sO=st(tOrc,mrO),sL=st(tLit,mrL),sR=st(tRec,mrR),sP=st(tPed,mrP);

  document.getElementById('v-alc').textContent=fmt(Math.round(tAlc));
  document.getElementById('v-at').textContent=fmt(Math.round(tAt));
  document.getElementById('v-orc').textContent=fmt(Math.round(tOrc));
  document.getElementById('v-ped').textContent=fmt(Math.round(tPed));
  document.getElementById('v-lit').innerHTML=fmt(Math.round(tLit))+'<span class="u"> L</span>';
  document.getElementById('v-rec').textContent='R$ '+fmt(Math.round(tRec));
  document.getElementById('v-tp').textContent='R$ '+fmt(Math.round(tmP));
  document.getElementById('v-tl').innerHTML=tmL.toFixed(1)+'<span class="u"> L</span>';
  document.getElementById('v-rl').textContent='R$ '+rL.toFixed(2).replace('.',',');

  // Bezels L1 — info mais útil que "X% de conversão"
  const bzAlc = tAlc ? '1 atend a cada ' + Math.round(tAlc / Math.max(tAt,1)) + ' contatos' : '—';
  const bzAt  = tAt  ? Math.round(tOrc / Math.max(tAt,1) * 100) + '% viram orçamento' : '—';
  const bzOrc = tOrc ? Math.round(tPed / Math.max(tOrc,1) * 100) + '% fecharam pedido' : '—';
  const bzPed = tOrc ? Math.round(tPed/Math.max(tOrc,1)*100)+'% dos orç. viraram pedido' : '—';
  document.getElementById('bz-alc').textContent=bzAlc;
  document.getElementById('bz-at').textContent=bzAt;
  document.getElementById('bz-orc').textContent=bzOrc;
  document.getElementById('bz-ped').textContent=bzPed;
  document.getElementById('bz-lit').textContent=fmt(Math.round(aL))+' L/semana em média';
  document.getElementById('bz-rec').textContent='R$ '+fmt(Math.round(aR))+'/semana em média';
  document.getElementById('bz-tp').textContent='~R$ '+fmt(Math.round(tmP))+' por evento';
  document.getElementById('bz-tl').textContent='~'+tmL.toFixed(1)+' L por evento';
  document.getElementById('bz-rl').textContent='~R$ '+rL.toFixed(2).replace('.',',')+' por litro vendido';

  // Evolução vs ano anterior
  function fmtEvo(res, ant) {
    if (!ant) return '—';
    const pct = ((res - ant) / ant * 100);
    const arrow = pct >= 0 ? '↑' : '↓';
    const color = pct >= 0 ? '#1E7A42' : '#B82418';
    const el = document.createElement ? null : null; // inline via textContent + style
    return { txt: arrow+' '+Math.abs(Math.round(pct))+'% vs 2025', color };
  }
  function setEvo(id, res, ant) {
    const el = document.getElementById(id+'-evo');
    if (!el) return;
    if (!ant) { el.textContent = '—'; el.style.color = '#9BA8B0'; return; }
    const pct = (res - ant) / ant * 100;
    el.textContent = (pct >= 0 ? '↑ ' : '↓ ') + Math.abs(Math.round(pct)) + '% vs 2025';
    el.style.color = pct >= 0 ? '#1E7A42' : '#B82418';
  }
  setEvo('bz-alc', tAlc, alc.anoAnt);
  setEvo('bz-at',  tAt,  at.anoAnt); // anoAnt da planilha, tAt do EZ
  setEvo('bz-orc', tOrc, orc.anoAnt);
  setEvo('bz-ped', tPed, ped.anoAnt);
  setEvo('bz-lit', tLit, lit.anoAnt);
  setEvo('bz-rec', tRec, fat.anoAnt);

  setS('c-orc',sO);setS('c-ped',sP);setS('c-lit',sL);setS('c-rec',sR);
  setTip('ct-alc','Meta: '+fmt(Math.round(mrAlc))+' · Real: '+fmt(Math.round(tAlc)));
  setTip('ct-at','Meta: '+fmt(Math.round(mrAt))+' · Real: '+fmt(Math.round(tAt)));
  setTip('ct-orc','Meta: '+fmt(Math.round(mrO))+' · Real: '+fmt(Math.round(tOrc)));
  setTip('ct-ped','Meta: '+fmt(Math.round(mrP))+' · Real: '+fmt(Math.round(tPed)));
  setTip('ct-lit','Meta: '+fmt(Math.round(mrL))+'L · Real: '+fmt(Math.round(tLit))+'L');
  setTip('ct-rec','Meta: R$ '+fmt(Math.round(mrR))+' · Real: R$ '+fmt(Math.round(tRec)));

  circ('ci-alc',mrAlc?(tAlc/mrAlc*100):0,SC[sAlc],pl(Math.round(tAlc),Math.round(mrAlc)));
  circ('ci-at',mrAt?(tAt/mrAt*100):0,SC[sAt],pl(Math.round(tAt),Math.round(mrAt)));
  circ('ci-orc',mrO?(tOrc/mrO*100):0,SC[sO],pl(tOrc,mrO));
  circ('ci-ped',mrP?(tPed/mrP*100):0,SC[sP],pl(tPed,mrP));
  circ('ci-lit',mrL?(tLit/mrL*100):0,SC[sL],pl(Math.round(tLit),Math.round(mrL)));
  circ('ci-rec',mrR?(tRec/mrR*100):0,SC[sR],pl(Math.round(tRec),Math.round(mrR)));

  // Sparklines — filtra semanas sem dados para evitar quedas bruscas para zero
  {
    const spMes = (mesRaw === 0 || tri) ? (new Date().getMonth()+1) : mes;
    const allSems = [1,2,3,4].map(s => {
      const fv = SEMANAL_RAW['Faturamento']?.[spMes]?.[s]?.res || 0;
      const pv = SEMANAL_RAW['Pedidos']?.[spMes]?.[s]?.res || 0;
      const lv = SEMANAL_RAW['Litros vendidos']?.[spMes]?.[s]?.res || 0;
      return { s, fv, pv, lv, hasData: pv > 0 || fv > 0 };
    });
    // Só plota semanas com dado — mínimo 2 pontos para desenhar linha
    const comDado = allSems.filter(d => d.hasData);
    const semsFiltradas = comDado.length >= 2 ? comDado : allSems;
    const spLabels = semsFiltradas.map(d => 'S'+d.s);
    const spP = semsFiltradas.map(d => d.pv ? d.fv/d.pv : 0);
    const spL = semsFiltradas.map(d => d.pv ? d.lv/d.pv : 0);
    const spR = semsFiltradas.map(d => d.lv ? d.fv/d.lv : 0);
    const hlIdx = sem > 0 ? semsFiltradas.findIndex(d => d.s === sem) : -1;
    requestAnimationFrame(()=>{
      spark('sp-tp', spP, spLabels, fR, hlIdx);
      spark('sp-tl', spL, spLabels, fL, hlIdx);
      spark('sp-rl', spR, spLabels, v=>'R$'+v.toFixed(2).replace('.',','), hlIdx);
    });
  }

  hkpi('hk-lit','hv-lit','ht-lit',tLit,mrL,v=>fmt(Math.round(v))+'<span class="u"> L</span>');
  hkpi('hk-rec','hv-rec','ht-rec',tRec,mrR,v=>'R$'+Math.round(v/1000)+'k');
  const cvPct=tOrc?(tPed/tOrc*100):0;
  document.getElementById('hv-cv').textContent=tOrc?cvPct.toFixed(1)+'%':'—';
  const cvBar=document.getElementById('hb-cv');
  if(cvBar){
    const cvSt=cvPct>=50?'green':cvPct>=30?'yellow':'red';
    cvBar.className='hk-bar '+cvSt;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{cvBar.style.width=Math.min(cvPct,100).toFixed(1)+'%';}));
    const cvPctEl=document.getElementById('hp-cv');
    if(cvPctEl)cvPctEl.textContent=Math.min(cvPct,100).toFixed(0)+'%';
  }
  const MESES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const resumoEl=document.getElementById('h-resumo-lbl');
  const triSel = parseInt(document.getElementById('f-tri')?.value) || 0;
  const triNomes = {1:'Q1 · Jan–Mar', 2:'Q2 · Abr–Jun', 3:'Q3 · Jul–Set', 4:'Q4 · Out–Dez'};
  if(resumoEl) resumoEl.textContent = mesRaw===0 ? 'Resumo Anual' : triSel ? triNomes[triSel] : sem ? MESES[mes-1]+' · S'+sem : 'Resumo '+MESES[mes-1];

  // CSAT na aba 1 — renderizar nos cards da ROW 4
  {
    const csatDef = mesRaw === 0
      ? {de:`${new Date().getFullYear()}-01-01`, ate:`${new Date().getFullYear()}-12-31`}
      : getDateRangeForFilter(mes, sem);
    const csatMF = tri && TRI_MESES[tri] ? TRI_MESES[tri] : null;
    const csatTix = EZ_TICKETS.filter(d => {
      if (mesRaw === 0) return true;
      if (csatMF) return csatMF.includes(parseInt(d.DataStr.slice(5,7)));
      return d.DataStr >= csatDef.de && d.DataStr <= csatDef.ate;
    });
    const csat = calcCSAT(csatTix);

    const elTot  = document.getElementById('v-csat-tot');
    const elSub  = document.getElementById('v-csat-sub');
    const elDist = document.getElementById('csat-dist-body');
    const elDSub = document.getElementById('csat-dist-sub');
    const elScr  = document.getElementById('csat-score-body');

    if (csat.total > 0) {
      if (elTot)  elTot.textContent  = csat.total;
      if (elSub)  elSub.textContent  = csat.total + ' ticket' + (csat.total!==1?'s':'') + ' avaliados';
      if (elDSub) elDSub.textContent = 'Resultado por categoria · ' + csat.total + ' avaliações';

      // Distribuição
      if (elDist) {
        const cats=[
          {emoji:'😄',label:'Totalmente Satisfeito',cat:'total. satisfeito',color:'#1E7A42'},
          {emoji:'🙂',label:'Satisfeito',cat:'satisfeito',color:'#2E8B4A'},
          {emoji:'😐',label:'Neutro',cat:'neutro',color:'#966A00'},
          {emoji:'🙁',label:'Insatisfeito',cat:'insatisfeito',color:'#C25A1A'},
          {emoji:'😠',label:'Totalmente Insatisfeito',cat:'total. insatisfeito',color:'#B82418'}
        ];
        elDist.innerHTML = '<div style="margin-top:8px;">'
          + cats.map(({emoji,label,cat,color})=>{
            const n = csatTix.filter(t=>t.CSAT&&t.CSAT.toLowerCase()===cat).length;
            const pct = Math.round(n/csat.total*100);
            return '<div style="margin-bottom:7px;">'
              +'<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">'
              +'<span style="font-size:13px;">'+emoji+'</span>'
              +'<span style="font-family:Barlow,sans-serif;font-size:11px;font-weight:600;color:var(--txt-faint);flex:1;">'+label+'</span>'
              +'<span style="font-family:Barlow,sans-serif;font-size:13px;font-weight:800;color:'+color+';">'+pct+'%</span>'
              +'</div>'
              +'<div style="height:3px;background:rgba(180,165,140,0.12);border-radius:2px;overflow:hidden;">'
              +'<div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:2px;transition:width 0.8s ease;"></div>'
              +'</div></div>';
          }).join('')
          + '</div>';
      }

      // Score
      if (elScr) {
        const score = csat.pctSat - csat.pctInsat;
        const sc = score>=50?'#1E7A42':score>=20?'#2E8B4A':score>=0?'#966A00':'#B82418';
        const sl = score>=50?'Excelente':score>=20?'Bom':score>=0?'Atenção':'Crítico';
        elScr.innerHTML = '<div class="ez-kpi-val" style="font-size:56px;font-weight:700;color:'+sc+';margin-top:4px;">'+(score>0?'+':'')+score+'</div>'
          +'<div style="font-family:Barlow,sans-serif;font-size:13px;font-weight:600;color:'+sc+';letter-spacing:1px;">'+sl+'</div>'
          +'<div style="font-family:Barlow,sans-serif;font-size:12px;color:var(--txt-faint);margin-top:8px;">'
          +'<span style="color:#1E7A42;">'+csat.pctSat+'% satisfeitos</span>'
          +' · <span style="color:#B82418;">'+csat.pctInsat+'% insatisfeitos</span>'
          +'</div>';
      }
    } else {
      if (elTot) elTot.textContent = '—';
      if (elSub) elSub.textContent = 'Sem avaliações no período';
      if (elDist) elDist.innerHTML = '';
      if (elScr)  elScr.innerHTML  = '<div class="ez-kpi-val" style="font-size:56px;margin-top:4px;">—</div>';
    }
  }

  // Atualiza abas ativas ao filtrar
  ezRendered=false;
  if(document.getElementById('tab-ez')?.classList.contains('active'))renderEZ();
  if(document.getElementById('tab-metas')?.classList.contains('active'))renderMetas();
}

/* ── ABA EZ ── */
let ezRendered=false;
function renderEZ(){
  if(ezRendered)return;
  ezRendered=true;
  const mes  = parseInt(document.getElementById('f-mes')?.value) || (new Date().getMonth()+1);

  const sem  = parseInt(document.getElementById('f-sem')?.value) || 0;
  const resp = document.getElementById('f-resp')?.value || '';
  const ezMesRaw = parseInt(document.getElementById('f-mes')?.value);
  const {de, ate} = ezMesRaw === 0
    ? { de: `${new Date().getFullYear()}-01-01`, ate: `${new Date().getFullYear()}-12-31` }
    : getDateRangeForFilter(mes, sem);

  const data=EZ_TICKETS.filter(d=>{
    if(de&&d.DataStr<de)return false;
    if(ate&&d.DataStr>ate)return false;
    if(resp&&d.Agente!==resp)return false;
    return true;
  });


  const total=data.length;
  const tpiMed=data.reduce((s,d)=>s+(d.TPI_min||0),0)/Math.max(total,1);
  const tmaMed=data.reduce((s,d)=>s+(d.TMA_min||0),0)/Math.max(total,1);
  const ativo=data.filter(d=>d.Ativo==='ATIVO').length;
  const recep=data.filter(d=>d.Ativo==='RECEPTIVO').length;

  // Classificações — 100% de EZ_TICKETS
  const classCount={};
  data.forEach(d=>{ const c=d.Classificacao||'Sem Classificação'; classCount[c]=(classCount[c]||0)+1; });
  const classSort=Object.entries(classCount).sort((a,b)=>b[1]-a[1]).slice(0,7)
    .map(([label,count])=>({label,count,pct:total?count/total:0}));

  // Performance por agente — 100% de EZ_TICKETS
  const agentesUniq=[...new Set(EZ_TICKETS.map(d=>d.Agente))].filter(Boolean).sort();
  const perf=agentesUniq.map(a=>{
    const ag=data.filter(d=>d.Agente===a);
    if(!ag.length)return null;
    const fin=ag.filter(d=>d.Status==='Finalizado').length;
    const tpi=ag.reduce((s,d)=>s+(d.TPI_min||0),0)/Math.max(ag.length,1);
    const tma=ag.reduce((s,d)=>s+(d.TMA_min||0),0)/Math.max(ag.length,1);
    const cc={};ag.forEach(d=>{const c=d.Classificacao||'Sem class.';cc[c]=(cc[c]||0)+1;});
    const topClass=Object.entries(cc).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
    return{nome:a,tickets:ag.length,fin,tpiMin:tpi,tmaMin:tma,topClass};
  }).filter(Boolean);

  function fmtMin(v){
    const min=Math.round(v);
    if(min<60)return min+'min';
    return Math.floor(min/60)+'h '+String(min%60).padStart(2,'0')+'min';
  }

  const classColors=['#3D6490','#2E6644','#6B4E10','#8B3A8B','#C8941A','#9BA8B0','#B85C38'];
  const totalLabel=total.toLocaleString('pt-BR');
  const bezLabel=ativo+' ativos · '+recep+' receptivos';
  const tpiLabel=fmtMin(tpiMed);
  const tmaLabel=fmtMin(tmaMed);

  // CSAT na aba EZ
  const csatEZ      = calcCSAT(data);
  const csatTotEZ   = csatEZ.total > 0 ? csatEZ.total + ' avaliações' : '—';
  const csatSatEZ   = csatEZ.total > 0 ? csatEZ.pctSat  + '%' : '—';
  const csatInsEZ   = csatEZ.total > 0 ? csatEZ.pctInsat + '%' : '—';
  const csatSatColor = csatEZ.pctSat  >= 70 ? '#1E7A42' : csatEZ.pctSat  >= 50 ? '#966A00' : '#B82418';
  const csatInsColor = csatEZ.pctInsat <= 10 ? '#1E7A42' : csatEZ.pctInsat <= 20 ? '#966A00' : '#B82418';

  let html=`
  <div class="row">
    <div class="card line-l1" data-s="none">
      <div class="card-ab">
        <div class="c-header"><div class="c-title pill-l1">Total de Tickets</div><div class="c-sub">Protocolos com atendimento humano</div></div>
        <div class="c-center"><div class="c-val-block">
          <div class="ez-kpi-val">${totalLabel}</div>
          <span class="bezel neu">${bezLabel}</span>
        </div></div>
      </div>
    </div>
    <div class="card line-l1" data-s="none">
      <div class="card-ab">
        <div class="c-header"><div class="c-title pill-l1">TPI Médio</div><div class="c-sub">Tempo para primeira interação · equipe</div></div>
        <div class="c-center"><div class="c-val-block">
          <div class="ez-kpi-val" style="font-size:38px;">${tpiLabel}</div>
          <span class="bezel neu">tempo de resposta inicial</span>
        </div></div>
      </div>
    </div>
    <div class="card line-l1" data-s="none">
      <div class="card-ab">
        <div class="c-header"><div class="c-title pill-l1">TMA Médio</div><div class="c-sub">Tempo médio de atendimento · equipe</div></div>
        <div class="c-center"><div class="c-val-block">
          <div class="ez-kpi-val" style="font-size:38px;">${tmaLabel}</div>
          <span class="bezel neu">duração média por ticket</span>
        </div></div>
      </div>
    </div>
  </div>



  <div class="row" style="grid-template-columns:1fr 1fr;">
    <div class="card line-l2" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header"><div class="c-title pill-l2">Classificação dos Tickets</div><div class="c-sub">Distribuição por tipo de resultado</div></div>
        <div style="margin-top:10px;width:100%;">
          ${classSort.map(({label,count,pct},i)=>`
            <div class="ez-bar-row" style="margin-bottom:8px;font-size:13px;">
              <div class="ez-bar-label" style="font-size:13px;">${label}</div>
              <div class="ez-bar-track" style="height:8px;"><div class="ez-bar-fill" style="width:${(pct*100).toFixed(1)}%;background:${classColors[i%classColors.length]};height:8px;border-radius:4px;"></div></div>
              <div class="ez-bar-pct" style="font-size:13px;">${Math.round(pct*100)}%</div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card line-l2" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header"><div class="c-title pill-l2">Picos de Demanda</div><div class="c-sub">Mapa de calor · dia da semana × hora do dia</div></div>
        <div id="ez-heatmap" style="margin-top:8px;overflow:hidden;"></div>
      </div>
    </div>
  </div>

  <div class="row" style="grid-template-columns:1fr;">
    <div class="card line-l3" data-s="none" style="height:auto;">
      <div class="card-ab" style="height:auto;padding-bottom:16px;">
        <div class="c-header"><div class="c-title pill-l3">Performance por Agente</div><div class="c-sub">Consolidado do período · ordenado por volume</div></div>
        <div style="margin-top:12px;overflow-x:auto;">
          <table class="ez-table">
            <thead><tr>
              <th>Agente</th><th>Tickets</th><th>Finalizados</th><th>% Finalizado</th>
              <th>TPI Médio</th><th>TMA Médio</th><th>CSAT</th>
            </tr></thead>
            <tbody>
              ${perf.sort((a,b)=>b.tickets-a.tickets).map(p=>{
                const agCSAT = calcCSAT(data.filter(t=>t.Agente===p.nome));
                const csatColor = agCSAT.pctSat>=70?'#1E7A42':agCSAT.pctSat>=50?'#966A00':'#B82418';
                const tipTxt = agCSAT.pctSat+'% satisfeitos · '+agCSAT.pctInsat+'% insatisfeitos · '+agCSAT.total+' aval.';
                const csatStr = agCSAT.total > 0
                  ? '<span class="ez-csat-tip" data-tip="'+tipTxt+'" style="cursor:help;color:'+csatColor+';font-weight:700;">'+agCSAT.pctSat+'%</span>'
                    +' <span style="font-size:10px;color:var(--txt-faint);">('+agCSAT.total+')</span>'
                  : '<span style="color:var(--txt-faint);">—</span>';
                return '<tr>'
                  +'<td class="agent">'+p.nome+'</td>'
                  +'<td class="num">'+p.tickets+'</td>'
                  +'<td class="num">'+p.fin+'</td>'
                  +'<td>'+(p.tickets?Math.round((p.fin/p.tickets)*100)+'%':'—')+'</td>'
                  +'<td>'+fmtMin(p.tpiMin||0)+'</td>'
                  +'<td>'+fmtMin(p.tmaMin||0)+'</td>'
                  +'<td>'+csatStr+'</td>'
                  +'</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

  // ── Card 1.2: Janelas Críticas — TPI só horário comercial (08h-18h) ──
  {
    const HORA_LABELS = ['00h','01h','02h','03h','04h','05h','06h','07h','08h','09h','10h','11h','12h','13h','14h','15h','16h','17h','18h','19h','20h','21h','22h','23h'];
    const HC_START = 8, HC_END = 18; // Horário comercial

    const horaBuckets = {};
    data.forEach(d => {
      const h = d.Hora;
      if(!horaBuckets[h]) horaBuckets[h] = {total:0, semClass:0, tpiSum:0, tpiCount:0};
      horaBuckets[h].total++;
      if(!d.Classificacao || d.Classificacao==='Sem Classificação') horaBuckets[h].semClass++;
      // TPI só conta tickets que chegaram no horário comercial
      if(d.TPI_min > 0 && h >= HC_START && h < HC_END){
        horaBuckets[h].tpiSum += d.TPI_min;
        horaBuckets[h].tpiCount++;
      }
    });

    // Só horários comerciais (08h-17h) — remove madrugada e noite
    const horas = Object.keys(horaBuckets).map(Number).filter(h => h >= HC_START && h < HC_END && horaBuckets[h].total >= 3).sort((a,b)=>a-b);
    function fmtH(m){ const min=Math.round(m); return min<60?min+'min':Math.floor(min/60)+'h'+(min%60?String(min%60).padStart(2,'0'):''); }

    // Gerar cards de horário com ordenação dinâmica
    function buildCards(horasOrdenadas) {
      return horasOrdenadas.map(h=>{
        const b = horaBuckets[h];
        const perdaPct = b.total ? (b.semClass/b.total*100) : 0;
        const tpiVal   = b.tpiCount ? b.tpiSum/b.tpiCount : null;
        // Sem Classificação: <30=verde, 30-49=amarelo, >=50=vermelho
        const cP = perdaPct>=50?'#B82418':perdaPct>=30?'#966A00':'#2E8B4A';
        // TPI: <25=verde, 25-39=amarelo, >=40=vermelho
        const cT = tpiVal===null?'#9BA8B0':tpiVal>=40?'#B82418':tpiVal>=25?'#966A00':'#2E8B4A';
        const tpiStr = tpiVal!==null ? fmtH(tpiVal) : '—';
        return '<div style="background:rgba(180,165,140,0.06);border-radius:6px;padding:10px 12px;">'
          +'<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">'
          +'<span style="font-family:Barlow,sans-serif;font-size:22px;font-weight:800;color:var(--txt);">'+HORA_LABELS[h]+'</span>'
          +'<span style="font-family:Barlow,sans-serif;font-size:12px;font-weight:600;color:var(--txt-faint);">'+b.total+' tickets</span>'
          +'</div>'
          +'<div style="display:flex;gap:16px;">'
          +'<div><div style="font-family:Barlow,sans-serif;font-size:9px;letter-spacing:0.8px;color:var(--txt-faint);margin-bottom:2px;">SEM CLASSIF.</div>'
          +'<div style="font-family:Barlow,sans-serif;font-size:20px;font-weight:700;color:'+cP+';">'+perdaPct.toFixed(0)+'%</div></div>'
          +'<div><div style="font-family:Barlow,sans-serif;font-size:9px;letter-spacing:0.8px;color:var(--txt-faint);margin-bottom:2px;">TPI MÉDIO</div>'
          +'<div style="font-family:Barlow,sans-serif;font-size:20px;font-weight:700;color:'+cT+';">'+tpiStr+'</div></div>'
          +'</div>'
          +'</div>';
      }).join('');
    }

    const horasCron    = [...horas];
    const horasPerda   = [...horas].sort((a,b)=>(horaBuckets[b].semClass/horaBuckets[b].total)-(horaBuckets[a].semClass/horaBuckets[a].total));
    const horasTPI     = [...horas].filter(h=>horaBuckets[h].tpiCount>0).sort((a,b)=>(horaBuckets[b].tpiSum/horaBuckets[b].tpiCount)-(horaBuckets[a].tpiSum/horaBuckets[a].tpiCount));

    const card12HTML = `
    <div class="row" style="grid-template-columns:1fr;">
      <div class="card line-l3" data-s="none" style="height:auto;">
        <div class="card-ab" style="height:auto;padding-bottom:20px;">
          <div class="c-header" style="flex-wrap:wrap;gap:8px;">
            <div>
              <div class="c-title pill-l3">Janelas Críticas de Atendimento</div>
              <div class="c-sub">Horário comercial 08h–18h · TPI e perda calculados apenas nesse período</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
              <span style="font-family:Barlow,sans-serif;font-size:10px;color:var(--txt-faint);letter-spacing:0.8px;">Ordenar</span>
              <button onclick="ez12Sort('cron',this)" class="ez12-btn ez12-active" style="font-family:Barlow,sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:4px;border:1px solid rgba(180,165,140,0.3);background:rgba(180,165,140,0.1);color:var(--txt-faint);cursor:pointer;letter-spacing:0.5px;">Horário</button>
              <button onclick="ez12Sort('perda',this)" class="ez12-btn" style="font-family:Barlow,sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:4px;border:1px solid rgba(180,165,140,0.3);background:rgba(180,165,140,0.1);color:var(--txt-faint);cursor:pointer;letter-spacing:0.5px;">Sem Classificação</button>
              <button onclick="ez12Sort('tpi',this)" class="ez12-btn" style="font-family:Barlow,sans-serif;font-size:11px;font-weight:600;padding:4px 10px;border-radius:4px;border:1px solid rgba(180,165,140,0.3);background:rgba(180,165,140,0.1);color:var(--txt-faint);cursor:pointer;letter-spacing:0.5px;">Maior TPI</button>
            </div>
          </div>
          <div id="ez12-grid" style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
            ${buildCards(horasCron)}
          </div>
        </div>
      </div>
    </div>`;

    html += card12HTML;

    // Dados para o sort (armazenados globalmente para o onclick funcionar)
    window._ez12 = { horasCron, horasPerda, horasTPI, buildCards };
  }

  document.getElementById('ez-main').innerHTML=html;

  // Função de ordenação do card 1.2
  window.ez12Sort = function(tipo, btn) {
    if(!window._ez12) return;
    const {horasCron, horasPerda, horasTPI, buildCards} = window._ez12;
    const grid = document.getElementById('ez12-grid');
    if(!grid) return;
    const horas = tipo==='perda' ? horasPerda : tipo==='tpi' ? horasTPI : horasCron;
    grid.innerHTML = buildCards(horas);
    document.querySelectorAll('.ez12-btn').forEach(b=>{
      b.style.color='var(--txt-faint)';
      b.style.borderColor='rgba(180,165,140,0.3)';
      b.style.background='rgba(180,165,140,0.1)';
    });
    btn.style.color='var(--gold,#FFA62C)';
    btn.style.borderColor='var(--gold,#FFA62C)';
    btn.style.background='rgba(255,166,44,0.1)';
  };

  // Tooltip para colunas CSAT na tabela — estilo sp-tip
  const ezMain = document.getElementById('ez-main');
  let csatTip = document.querySelector('.sp-tip[data-id="ez-csat"]');
  if(!csatTip){ csatTip=document.createElement('div'); csatTip.className='sp-tip'; csatTip.dataset.id='ez-csat'; document.body.appendChild(csatTip); }
  ezMain.addEventListener('mouseover', e=>{
    const el = e.target.closest('.ez-csat-tip');
    if(el){ csatTip.textContent=el.dataset.tip; csatTip.style.left=(e.clientX+12)+'px'; csatTip.style.top=(e.clientY-32)+'px'; csatTip.style.opacity='1'; }
  });
  ezMain.addEventListener('mousemove', e=>{
    if(e.target.closest('.ez-csat-tip')){ csatTip.style.left=(e.clientX+12)+'px'; csatTip.style.top=(e.clientY-32)+'px'; }
  });
  ezMain.addEventListener('mouseout', e=>{
    if(!e.target.closest('.ez-csat-tip')) csatTip.style.opacity='0';
  });
  buildHeatmapFromTickets(data);
}

/* ══ HEATMAP ══ */
function buildHeatmapFromTickets(data){
  const DAYS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const matrix=Array.from({length:7},()=>new Array(24).fill(0));
  data.forEach(d=>{
    const hora=d.Hora;
    if(hora<0||hora>23)return;
    const dt=new Date(d.DataStr+'T12:00:00');
    if(isNaN(dt))return;
    matrix[dt.getDay()][hora]++;
  });
  renderHeatmapMatrix(DAYS,matrix);
}

function renderHeatmapMatrix(DAYS,matrix){
  const el=document.getElementById('ez-heatmap');
  if(!el)return;
  const maxVal=Math.max(...matrix.flat(),1);
  function getColor(val){
    if(val===0)return'rgba(200,185,160,0.10)';
    const t=val/maxVal;
    if(t<=0.33){const p=t/0.33;return`rgb(${Math.round(241+(255-241)*p)},${Math.round(227+(166-227)*p)},${Math.round(206+(44-206)*p)})`;}
    else{const p=(t-0.33)/0.67;return`rgb(${Math.round(255+(201-255)*p)},${Math.round(166+(43-166)*p)},${Math.round(44+(30-44)*p)})`;}
  }
  function textColor(val){return(val/maxVal)>0.45?'#FFF8F0':'#8B7040';}
  const cellW=22,cellH=28,leftPad=32,topPad=22,bottomPad=22;
  const svgW=leftPad+24*cellW+4,svgH=topPad+7*cellH+bottomPad;
  let inner='';
  for(let h=0;h<24;h++){
    if(h%3===0)inner+=`<text x="${leftPad+h*cellW+cellW/2}" y="${topPad-5}"
      text-anchor="middle" font-family="Barlow Condensed,sans-serif" font-size="9" fill="#A89870">${String(h).padStart(2,'0')}h</text>`;
  }
  for(let d=0;d<7;d++){
    const y=topPad+d*cellH;
    inner+=`<text x="${leftPad-4}" y="${y+cellH/2+4}" text-anchor="end"
      font-family="Barlow Condensed,sans-serif" font-size="9" font-weight="600" fill="#A89870">${DAYS[d]}</text>`;
    for(let h=0;h<24;h++){
      const x=leftPad+h*cellW,val=matrix[d][h];
      inner+=`<rect x="${x+1}" y="${y+1}" width="${cellW-2}" height="${cellH-2}" rx="2" fill="${getColor(val)}"
        data-val="${val}" data-day="${DAYS[d]}" data-hour="${String(h).padStart(2,'0')}h"/>`;
      if(val>0)inner+=`<text x="${x+cellW/2}" y="${y+cellH/2+4}" text-anchor="middle"
        font-family="Barlow Condensed,sans-serif" font-size="10" font-weight="600"
        fill="${textColor(val)}" pointer-events="none">${val}</text>`;
    }
  }
  inner+=`<text x="${leftPad-4}" y="${topPad+7*cellH+bottomPad-5}" text-anchor="end"
    font-family="Barlow Condensed,sans-serif" font-size="9" fill="rgba(168,152,112,0.6)">total</text>`;
  for(let h=0;h<24;h++){
    const tot=matrix.reduce((s,row)=>s+row[h],0);
    if(tot>0)inner+=`<text x="${leftPad+h*cellW+cellW/2}" y="${topPad+7*cellH+bottomPad-5}" text-anchor="middle"
      font-family="Barlow Condensed,sans-serif" font-size="9" fill="rgba(168,152,112,0.7)">${tot}</text>`;
  }
  el.innerHTML=`<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg" style="display:block;">${inner}</svg>`;
  const oldTip=document.querySelector('.sp-tip[data-id="heatmap"]');
  if(oldTip)oldTip.remove();
  const tip=document.createElement('div');
  tip.className='sp-tip';tip.dataset.id='heatmap';
  document.body.appendChild(tip);
  el.querySelectorAll('rect').forEach(r=>{
    r.style.cursor='default';
    r.addEventListener('mouseenter',e=>{
      const val=r.dataset.val;if(val==='0')return;
      tip.textContent=`${r.dataset.day} ${r.dataset.hour}: ${val} ticket${val!='1'?'s':''}`;
      tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-32)+'px';tip.style.opacity='1';
    });
    r.addEventListener('mousemove',e=>{tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-32)+'px';});
    r.addEventListener('mouseleave',()=>{tip.style.opacity='0';});
  });
}

/* ── CONTROLES ── */
function reset(){
  const fTri = document.getElementById('f-tri');
  if (fTri) fTri.value = '';
  const today=new Date();
  const m=document.getElementById('f-mes'),s=document.getElementById('f-sem'),r=document.getElementById('f-resp');
  if(m)m.value=String(today.getMonth()+1);
  if(s)s.value='0';
  if(r)r.value='';
  document.querySelectorAll('.btn-sh').forEach(b=>b.classList.remove('active'));
  go();
}

function setTrimestre(q) {
  if (!q) return;
  // Limpar semana ao selecionar trimestre
  const fSem = document.getElementById('f-sem');
  if (fSem) fSem.value = 0;
  go();
}

function setShortcut(type){
  const today=new Date();
  let mes=today.getMonth()+1, sem=0;
  if(type==='mes-passado'){ mes=today.getMonth()||12; }
  const m=document.getElementById('f-mes'),s=document.getElementById('f-sem');
  if(m)m.value=String(mes);
  if(s)s.value=String(sem);
  document.querySelectorAll('.btn-sh').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  go();
}

function setTab(el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  const tabName=el.textContent.trim();
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  const respGroup=document.getElementById('f-resp-group');
  if(respGroup)respGroup.style.display=tabName==='Performance Atendimento'?'flex':'none';
  if(tabName==='Performance Vendas')document.getElementById('tab-visao').classList.add('active');
  else if(tabName==='Performance Atendimento'){document.getElementById('tab-ez').classList.add('active');renderEZ();}
  else if(tabName==='Gestão de Metas'){document.getElementById('tab-metas').classList.add('active');renderMetas();}
  window.scrollTo(0,0);
}

/* ── FILTROS PADRÃO — mês atual, todo o mês ── */
(function(){
  const today=new Date();
  const m=document.getElementById('f-mes'),s=document.getElementById('f-sem');
  if(m)m.value=String(today.getMonth()+1);
  if(s)s.value='0';
})();

const _upd=document.getElementById('upd-date');
if(_upd){const _d=new Date();_upd.textContent=String(_d.getDate()).padStart(2,'0')+'/'+String(_d.getMonth()+1).padStart(2,'0')+'/'+_d.getFullYear();}

loadData();

/* ── AUTO-REFRESH a cada 10 minutos ── */
setInterval(async () => {
  await loadData();
}, 10 * 60 * 1000);
