/* =========================================================
   app.js — 화면 제어 · NEIS 연동 · 학급 단위 일괄 출력
   ---------------------------------------------------------
   로드 순서:  data.js → report.js → neis.js → app.js
   ========================================================= */

(function () {
  'use strict';

  const $  = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const val = (id, def) => { const el = $(id); return el ? el.value : def; };
  const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  const numOf = (id, def) => { const n = parseFloat(val(id, '')); return isNaN(n) ? def : n; };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function say(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    const base = el.classList.contains('batch-status') ? 'batch-status' : 'state';
    el.className = base + (kind ? ' is-' + kind : '');
  }

  const LS_FORM   = 'hcs.form.v3';
  const LS_CFG    = 'hcs.cfg.v3';
  const LS_COOP   = 'hcs.coop.v1';
  const LS_INFRA  = 'hcs.infra.v1';
  const LS_CREDIT = 'hcs.credit.v1';

  let batch = [];
  let PICKED_SCHOOL = null;
  let coopRows = [];               /* [{name, type:'online'|'offline', org}] */
  let infraChecked = new Set();    /* INFRA_QUESTIONS id 중 체크된 것 */
  let creditChecked = new Set();   /* CREDIT_QUESTIONS id 중 체크된 것 */

  function saveSchool(s) {
    PICKED_SCHOOL = s ? {
      name:     s.schoolName || '',
      type:     s.schoolType || 'general',
      code:     s.schoolCode || '',
      office:   s.officeName || '',
      region:   s.region || '',
      district: s.district || '',
      hsType:   s.hsType || s.kind || '',
      found:    s.found || '',
      address:  s.address || '',
      at:       Date.now()
    } : null;

    window.PICKED_SCHOOL = PICKED_SCHOOL;

    try {
      if (PICKED_SCHOOL) localStorage.setItem('pickedSchool', JSON.stringify(PICKED_SCHOOL));
      else localStorage.removeItem('pickedSchool');
    } catch (e) {}
  }

  function loadSchool() {
    try {
      var raw = localStorage.getItem('pickedSchool');
      if (raw) {
        PICKED_SCHOOL = JSON.parse(raw);
        window.PICKED_SCHOOL = PICKED_SCHOOL;
      }
    } catch (e) {}
  }

  loadSchool();

  function fieldBox(el) {
    if (!el) return null;
    return el.closest('.field, .form-row, .input-row, .card, .row') || el.parentElement;
  }

  function makeEl(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (text) e.textContent = text;
    return e;
  }

  function ensureUI() {
    const made = [];

    if (!$('fSchoolType')) {
      const anchor = $('fRegion') || $('fGrade');
      const box = fieldBox(anchor);
      if (box) {
        const wrap = makeEl('div', { class: 'field' });
        wrap.appendChild(makeEl('label', { for: 'fSchoolType' }, '학교 유형'));
        wrap.appendChild(makeEl('select', { id: 'fSchoolType' }));
        box.parentElement.insertBefore(wrap, box);
        made.push('fSchoolType');
      }
    }

    const sn = $('fSchoolName');
    if (sn) {
      const box = fieldBox(sn);

      if (!$('btnLookup')) {
        const btn = makeEl('button',
          { id: 'btnLookup', type: 'button', class: 'btn btn-primary btn-sm' },
          '개설 과목 조회');
        sn.insertAdjacentElement('afterend', btn);
        made.push('btnLookup');
      }
      if (!$('lookupState')) {
        const p = makeEl('p', { id: 'lookupState', class: 'state', 'aria-live': 'polite' });
        ($('btnLookup') || sn).insertAdjacentElement('afterend', p);
        made.push('lookupState');
      }

      if (!$('fOffered') && box) {
        const wrap = makeEl('div', { class: 'field' });
        wrap.appendChild(makeEl('label', { for: 'fOffered' }, '개설 과목 목록'));
        const ta = makeEl('textarea', {
          id: 'fOffered', rows: '5', spellcheck: 'false',
          placeholder: '조회하면 자동으로 채워집니다. 직접 입력할 때는 쉼표나 줄바꿈으로 구분하세요.\n예) 대수, 미적분Ⅰ, 확률과 통계, 물리학, 정보'
        });
        wrap.appendChild(ta);
        wrap.appendChild(makeEl('p', { class: 'hint' },
          '비워 두면 지역 기준값으로 추정합니다. 채우면 실제 개설 여부를 대조합니다.'));
        box.insertAdjacentElement('afterend', wrap);
        made.push('fOffered');
      }
    }

    const px = $('fProxy');
    if (px) {
      if (!$('btnSaveCfg')) {
        const btn = makeEl('button',
          { id: 'btnSaveCfg', type: 'button', class: 'btn btn-ghost btn-sm' },
          '인증 설정 저장');
        px.insertAdjacentElement('afterend', btn);
        made.push('btnSaveCfg');
      }
      if (!$('cfgState')) {
        const p = makeEl('p', { id: 'cfgState', class: 'state', 'aria-live': 'polite' });
        ($('btnSaveCfg') || px).insertAdjacentElement('afterend', p);
        made.push('cfgState');
      }
    }

    if (made.length && !$('hcsAutoStyle')) {
      const css = `
        #fOffered{width:100%;min-height:96px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
          padding:10px 12px;border:1px solid #d5dce8;border-radius:8px;resize:vertical;box-sizing:border-box}
        .state{margin:6px 0 0;font-size:12.5px;color:#5b6880;min-height:1em}
        .state.is-ok{color:#15803d}.state.is-err{color:#b91c1c}
        .state.is-warn{color:#b45309}.state.is-busy{color:#1d4ed8}
        .btn-sm{margin-top:8px;padding:7px 14px;font-size:13px;cursor:pointer;
          border-radius:8px;border:1px solid #cbd5e1;background:#fff}
        .btn-sm.btn-primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
        .hint{margin:6px 0 0;font-size:12px;color:#7c8598}
      `;
      const st = makeEl('style', { id: 'hcsAutoStyle' });
      st.textContent = css;
      document.head.appendChild(st);
    }

    if (made.length) console.info('[app.js] 자동 생성:', made.join(', '));
    return made;
  }

  function initSelects() {
    const st = $('fSchoolType');
    if (st) {
      const keep = st.value;
      st.innerHTML = Object.entries(SCHOOL_TYPES)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
      if (keep) st.value = keep;
    }

    const tr = $('fTrack');
    if (tr) {
      const keep = tr.value;
      tr.innerHTML = TRACK_GROUPS.map(g => {
        const opts = Object.entries(TRACKS)
          .filter(([, v]) => v.group === g)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
        return `<optgroup label="${g}">${opts}</optgroup>`;
      }).join('');
      if (keep && TRACKS[keep]) tr.value = keep;
    }

    const rg = $('fRegion');
    if (rg && !rg.options.length) {
      rg.innerHTML = Object.entries(BASELINE)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    }

    const lv = $('fLevel');
    if (lv && !lv.options.length) {
      lv.innerHTML = Object.entries(LEVEL_LABEL)
        .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    }

    const gr = $('fGrade');
    if (gr && !gr.options.length) {
      gr.innerHTML = [1, 2, 3].map(n => `<option value="${n}">${n}학년</option>`).join('');
    }

    if ($('fDate') && !val('fDate', '')) setVal('fDate', today());
    renderLegend();
  }

  function renderLegend() {
    const box = document.querySelector('.code-legend');
    if (!box) return;
    const byGroup = TRACK_GROUPS.map(g => {
      const items = Object.entries(TRACKS)
        .filter(([, v]) => v.group === g)
        .map(([k, v]) => `${k} ${v.label.split(' · ')[0]}`).join(' / ');
      return `<li><b>계열코드 · ${g}</b> ${items}</li>`;
    }).join('');
    const types = Object.entries(SCHOOL_TYPES).map(([k, v]) => `${k} ${v.short}`).join(' / ');
    box.innerHTML = byGroup +
      '<li><b>지역코드</b> big 대도시 / mid 중소도시 / rural 읍면지역</li>' +
      '<li><b>수준코드</b> low 기초 / mid 보통 / high 심화</li>' +
      `<li><b>학교유형</b>(12번째 열, 생략 가능) ${types}</li>` +
      '<li><b>학점제 점검표 총점</b>(13번째 열, 생략 가능) 0~100, 생략 시 65점</li>';
  }

  /* ---------- 공동교육과정 실사 표 ---------- */
  function saveCoop() {
    try { localStorage.setItem(LS_COOP, JSON.stringify(coopRows)); } catch (e) {}
  }
  function loadCoop() {
    try { coopRows = JSON.parse(localStorage.getItem(LS_COOP) || '[]'); } catch (e) { coopRows = []; }
  }

  function coopWeightedSum() {
    const sum = coopRows.reduce((s, r) => s + (COOP_TYPE_WEIGHT[r.type] || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  function renderCoopTable() {
    const box = $('coopTable');
    if (!box) return;

    box.innerHTML = coopRows.length ? coopRows.map((row, i) => `
      <div class="coop-row" data-i="${i}">
        <input type="text" class="coop-name" placeholder="과목명" value="${esc(row.name)}">
        <select class="coop-type">
          <option value="online"${row.type === 'online' ? ' selected' : ''}>온라인 쌍방향</option>
          <option value="offline"${row.type === 'offline' ? ' selected' : ''}>대면 거점</option>
        </select>
        <input type="text" class="coop-org" placeholder="운영 기관(선택)" value="${esc(row.org || '')}">
        <button type="button" class="coop-del" aria-label="삭제">✕</button>
      </div>`).join('')
      : '<p class="hint">등록된 실사 강좌가 없습니다. 강좌 추가를 눌러 입력하세요.</p>';

    const sumEl = $('coopSum');
    if (sumEl) sumEl.textContent = coopWeightedSum();

    box.querySelectorAll('.coop-row').forEach(rowEl => {
      const i = +rowEl.dataset.i;
      rowEl.querySelector('.coop-name').addEventListener('input', e => {
        coopRows[i].name = e.target.value.trim(); saveCoop(); renderSoon();
      });
      rowEl.querySelector('.coop-type').addEventListener('change', e => {
        coopRows[i].type = e.target.value; saveCoop();
        if (sumEl) sumEl.textContent = coopWeightedSum();
        renderSoon();
      });
      rowEl.querySelector('.coop-org').addEventListener('input', e => {
        coopRows[i].org = e.target.value.trim(); saveCoop(); renderSoon();
      });
      rowEl.querySelector('.coop-del').addEventListener('click', () => {
        coopRows.splice(i, 1); saveCoop(); renderCoopTable(); renderSoon();
      });
    });
  }

  function addCoopRow() {
    coopRows.push({ name: '', type: 'online', org: '' });
    saveCoop();
    renderCoopTable();
  }

  /* ---------- 점검표(디지털 인프라 · 학점제 운영) ---------- */
  function saveChecklist(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
  }
  function loadChecklist(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); }
  }
  function checklistSum(questions, checked) {
    return questions.reduce((s, q) => s + (checked.has(q.id) ? q.points : 0), 0);
  }

  function renderChecklist(containerId, questions, checked, sumId, storeKey) {
    const box = $(containerId);
    if (!box) return;

    box.innerHTML = questions.map(q => `
      <label class="check-item">
        <input type="checkbox" data-id="${q.id}"${checked.has(q.id) ? ' checked' : ''}>
        <span>${esc(q.label)}<i class="check-pt">${q.points}점${q.group ? ' · ' + esc(q.group) : ''}</i></span>
      </label>`).join('');

    const sumEl = $(sumId);
    const refresh = () => { if (sumEl) sumEl.textContent = checklistSum(questions, checked); };
    refresh();

    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(cb.dataset.id); else checked.delete(cb.dataset.id);
        refresh();
        saveChecklist(storeKey, checked);
        renderSoon();
      });
    });
  }

  function initChecklists() {
    loadCoop();
    infraChecked = loadChecklist(LS_INFRA);
    creditChecked = loadChecklist(LS_CREDIT);
    renderCoopTable();
    renderChecklist('infraList', INFRA_QUESTIONS, infraChecked, 'infraSum', LS_INFRA);
    renderChecklist('creditList', CREDIT_QUESTIONS, creditChecked, 'creditSum', LS_CREDIT);
    const cb = $('coopBase'); if (cb) cb.textContent = String(COOP_BASELINE);
  }

  /* 개설 과목 데이터가 있으면 희망 과목 개설률을 자동 계산값으로 표시 */
  function updateFitDisplay(d) {
    const input = $('fWant'), tag = $('fWantAutoTag'), hint = $('fWantHint');
    if (!input || typeof Report === 'undefined') return;
    const r = Report.buildSubjects(d);
    if (r.fitScore != null) {
      input.value = r.fitScore;
      input.readOnly = true;
      if (tag) tag.hidden = false;
      if (hint) hint.textContent = '개설 과목 조회 결과를 바탕으로 자동 계산되었습니다. 다시 손으로 입력하려면 개설 과목 목록을 비우세요.';
    } else {
      input.readOnly = false;
      if (tag) tag.hidden = true;
      if (hint) hint.textContent = '원하는 과목 중 교내 비율. 개설 과목을 조회하면 희망 계열의 희소 과목 가중치를 반영해 자동 계산됩니다.';
    }
  }

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}.`;
  }

  function parseOffered(text) {
    return [...new Set(String(text || '')
      .split(/[,\n;·|]/).map(s => s.trim()).filter(Boolean))];
  }

  const currentOffered = () => parseOffered(val('fOffered', ''));

  function collect() {
    const offered = currentOffered();
    return {
      schoolName: PICKED_SCHOOL ? PICKED_SCHOOL.name : (val('fSchoolName', '').trim() || ''),
      schoolInfo: PICKED_SCHOOL,
      name:       val('fName', '').trim(),
      no:         val('fNo', '').trim(),
      grade:      String(val('fGrade', '1')),
      schoolType: val('fSchoolType', 'general'),
      region:     val('fRegion', 'mid'),
      track:      val('fTrack', 'ai'),
      level:      val('fLevel', 'mid'),
      goal:       val('fGoal', '').trim(),
      memo:       val('fMemo', '').trim(),
      counselor:  val('fCounselor', '').trim(),
      date:       val('fDate', today()),
      subjects:   numOf('fSubjects', 80),
      dup:        numOf('fDup', 12),
      want:       numOf('fWant', 60),
      coop:       coopWeightedSum(),
      coopRows:   coopRows.filter(r => r.name),
      net:        checklistSum(INFRA_QUESTIONS, infraChecked),
      credit:     checklistSum(CREDIT_QUESTIONS, creditChecked),
      offered:    offered,
      source:     offered.length ? (window.__autoLoaded ? 'auto' : 'manual') : null
    };
  }
  window.collect = collect;

  let timer = null;

  function previewBox() {
    return $('preview') || $('stage')
      || document.querySelector('.preview-stage:not(#batchStage)');
  }

  function clearPreview() {
    const box = previewBox();
    if (box) box.innerHTML = '<p class="preview-empty">값을 입력한 뒤 "미리보기 갱신"을 누르면 리포트가 나타납니다.</p>';
  }

  function renderOne() {
    const box = previewBox();
    const d = collect();
    if (box) box.innerHTML = Report.render(d);
    updateFitDisplay(d);
  }

  /* 입력 중에는 리포트를 다시 그리지 않고, 희망 과목 개설률 자동계산 값만 갱신합니다.
     실제 리포트는 "미리보기 갱신" 버튼을 눌러야 반영됩니다. */
  function renderSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => { updateFitDisplay(collect()); saveForm(); }, 180);
  }

  const FORM_IDS = ['fName', 'fNo', 'fGrade', 'fSchoolType', 'fRegion', 'fTrack', 'fLevel',
    'fGoal', 'fMemo', 'fCounselor', 'fDate', 'fSubjects', 'fDup', 'fWant',
    'fOffered', 'fSchoolName'];

  function saveForm() {
    try {
      const o = {};
      FORM_IDS.forEach(id => { if ($(id)) o[id] = val(id, ''); });
      const b = $('batchInput'); if (b) o.batchInput = b.value;
      localStorage.setItem(LS_FORM, JSON.stringify(o));
    } catch (e) {}
  }

  function loadForm() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_FORM) || '{}');
      Object.entries(o).forEach(([id, v]) => setVal(id, v));
    } catch (e) {}
  }

  /* ---------- 인증 설정 · 실제 검증 ---------- */
  let cfgCheck = null;   /* 마지막 검증 결과 { sig, level, mode, message, at } */

  const currentCfg = () => ({
    key:   val('fKey', '').trim(),
    proxy: val('fProxy', '').trim().replace(/\/+$/, '')
  });
  const cfgSig = c => c.key + '|' + c.proxy;

  /* 입력값이 마지막으로 검증한 값과 같을 때만 그 결과를 유효하게 봅니다 */
  function activeCheck() {
    return cfgCheck && cfgCheck.sig === cfgSig(currentCfg()) ? cfgCheck : null;
  }

  function renderKeyChip() {
    const chip = $('keyChip'), tx = $('keyChipTx');
    if (!chip || !tx) return;
    const c = currentCfg();
    const chk = activeCheck();

    chip.classList.remove('is-on', 'is-warn', 'is-err');
    if (!chk) {
      tx.textContent = (c.key || c.proxy)
        ? '인증 설정 미확인 · 설정 저장을 눌러 검증하세요'
        : '인증키 없음 · 샘플 모드 또는 직접 입력으로 진행';
      return;
    }
    if (chk.level === 'ok') {
      chip.classList.add('is-on');
      tx.textContent = chk.mode === 'proxy' ? '프록시 연결 확인됨' : '나이스 인증키 확인됨';
    } else if (chk.level === 'warn') {
      chip.classList.add('is-warn');
      tx.textContent = chk.mode === 'sample' ? '샘플 모드 · 조회 결과가 일부만 나올 수 있음' : '인증 확인됨 · 주의 필요';
    } else {
      chip.classList.add('is-err');
      tx.textContent = '인증 설정 오류 · 1단계에서 확인하세요';
    }
  }

  function persistCfg(c) {
    localStorage.setItem(LS_CFG, JSON.stringify({ key: c.key, proxy: c.proxy, check: cfgCheck }));
  }

  async function saveCfg() {
    const c = currentCfg();
    try {
      persistCfg(c);
    } catch (e) {
      say('cfgState', '브라우저 저장소를 사용할 수 없습니다.', 'err');
      return;
    }

    if (typeof window.Neis === 'undefined' || !window.Neis.verify) {
      say('cfgState', '설정은 저장했지만 neis.js가 로드되지 않아 검증하지 못했습니다.', 'warn');
      return;
    }

    const btn = $('btnSaveCfg');
    if (btn) btn.disabled = true;
    say('cfgState', '나이스에 실제로 요청해 인증키와 프록시를 확인하는 중입니다…', 'busy');

    try {
      const r = await window.Neis.verify(c);
      /* 검증 도중 입력이 바뀌었으면 이 결과는 버립니다 */
      if (cfgSig(currentCfg()) !== cfgSig(c)) return;
      cfgCheck = { sig: cfgSig(c), level: r.level, mode: r.mode, message: r.message, at: Date.now() };
      persistCfg(c);
      say('cfgState', r.message, r.level);
      console.info('[neis] verify', r);
    } catch (e) {
      say('cfgState', '검증 중 예기치 못한 오류가 발생했습니다.', 'err');
      console.error('[neis] verify', e);
    } finally {
      if (btn) btn.disabled = false;
      renderKeyChip();
    }
  }

  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
      setVal('fKey', c.key || '');
      setVal('fProxy', c.proxy || '');
      cfgCheck = c.check || null;
      const chk = activeCheck();
      if (chk) say('cfgState', chk.message, chk.level);
      return c;
    } catch (e) { return {}; }
  }

  function onCfgInput() {
    renderKeyChip();
    const chk = activeCheck();
    if (chk) say('cfgState', chk.message, chk.level);
    else say('cfgState', '변경 사항이 있습니다. 설정 저장을 눌러 다시 검증하세요.', 'warn');
  }

async function lookup() {
  const name = val('fSchoolName', '').trim();
  if (!name) {
    say('lookupState', '학교명을 입력해 주세요.', 'err');
    return;
  }

  if (typeof window.Neis === 'undefined' || !window.Neis.fetchOffered) {
    say('lookupState', 'neis.js가 로드되지 않았습니다. 개설 과목을 직접 입력해 주세요.', 'err');
    return;
  }

  const cfg = {
    key:   val('fKey', '').trim(),
    proxy: val('fProxy', '').trim().replace(/\/+$/, '')
  };

  const btn = $('btnLookup');
  if (btn) btn.disabled = true;
  say('lookupState', '조회 중입니다…', 'busy');
  console.info('[neis] lookup', name, cfg);

  try {
    const res = await window.Neis.fetchOffered(name, cfg);

    if (!res || !res.subjects || !res.subjects.length) {
      say('lookupState', '개설 과목을 찾지 못했습니다. 직접 입력해 주세요.', 'err');
      return;
    }

    saveSchool(res.school);
    setVal('fOffered', res.subjects.join(', '));
    setVal('fSubjects', String(res.subjects.length));

    if (res.schoolType && $('fSchoolType') && SCHOOL_TYPES[res.schoolType]) {
      setVal('fSchoolType', res.schoolType);
    }

    window.__autoLoaded = true;
    console.info('[neis] lookup success', res);
    const chk = activeCheck();
    const sample = !chk || chk.mode === 'sample';
    say('lookupState',
      `${res.schoolName || name} · ${res.subjects.length}과목을 불러왔습니다.` +
      (sample ? ' 인증키가 확인되지 않은 샘플 모드라 일부 과목이 빠졌을 수 있습니다.' : ''),
      sample ? 'warn' : 'ok');
    renderSoon();

  } catch (err) {
    if (err && err.code === 'CANCELLED') {
      say('lookupState', '');
      return;
    }
    const code = (err && err.code) ? ` (${err.code})` : '';
    say('lookupState', `조회에 실패했습니다.${code} 개설 과목을 직접 입력해 주세요.`, 'err');
    console.error('[neis]', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}
  function toSchoolType(v, fallback) {
    const s = String(v || '').trim();
    if (!s) return fallback;
    if (SCHOOL_TYPES[s]) return s;
    const hit = Object.entries(SCHOOL_TYPES).find(([, o]) =>
      o.short === s || o.label === s || o.label.indexOf(s) >= 0);
    return hit ? hit[0] : fallback;
  }

  function toRegion(v) {
    const s = String(v || '').trim();
    if (BASELINE[s]) return s;
    const hit = Object.entries(BASELINE).find(([, o]) => o.label === s);
    if (hit) return hit[0];
    if (/대도시|광역|특별/.test(s)) return 'big';
    if (/읍|면|농어촌|도서/.test(s)) return 'rural';
    return 'mid';
  }

  function toTrack(v) {
    const s = String(v || '').trim();
    if (TRACKS[s]) return s;
    const exact = Object.entries(TRACKS).find(([, o]) => o.label === s);
    if (exact) return exact[0];
    const part = s && Object.entries(TRACKS).find(([, o]) => o.label.indexOf(s) >= 0);
    return part ? part[0] : null;
  }

  function toLevel(v) {
    const s = String(v || '').trim();
    if (LEVEL_LABEL[s]) return s;
    if (/기초/.test(s)) return 'low';
    if (/심화|도전/.test(s)) return 'high';
    return 'mid';
  }

  function toNum(v, def) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? def : n;
  }

  function splitLine(line) {
    const out = []; let cell = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { out.push(cell.trim()); cell = ''; }
      else cell += c;
    }
    out.push(cell.trim());
    return out;
  }

  function parseBatch(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
      .map(s => s.trim()).filter(Boolean);

    const offered = currentOffered();
    const common = {
      counselor: val('fCounselor', '').trim(),
      date: val('fDate', today()),
      offered: offered,
      source: offered.length ? (window.__autoLoaded ? 'auto' : 'manual') : null
    };
    const fallbackType = val('fSchoolType', 'general');
    const list = [], warn = [];

    lines.forEach((line, i) => {
      if (i === 0 && /이름/.test(line) && /학번/.test(line)) return;

      const c = splitLine(line);
      if (!c[0]) { warn.push(`${i + 1}행: 이름 없음`); return; }
      if (c.length < 3) { warn.push(`${i + 1}행: 항목 부족`); return; }

      const track = toTrack(c[3]);
      if (c[3] && !track) warn.push(`${i + 1}행: 계열코드 '${c[3]}' 인식 불가`);

      const g = String(toNum(c[2], 1));
      list.push({
        name: c[0],
        no: c[1] || '',
        grade: (g === '1' || g === '2' || g === '3') ? g : '1',
        track: track || 'ai',
        region: toRegion(c[4]),
        subjects: toNum(c[5], 80),
        dup: toNum(c[6], 12),
        want: toNum(c[7], 60),
        coop: toNum(c[8], 5),
        net: toNum(c[9], 70),
        level: toLevel(c[10]),
        schoolType: toSchoolType(c[11], fallbackType),
        credit: toNum(c[12], 65),
        goal: '', memo: '',
        counselor: common.counselor,
        date: common.date,
        offered: common.offered,
        source: common.source
      });
    });

    return { list, warn };
  }

  function runBatch() {
    const ta = $('batchInput'), stage = $('batchStage');
    if (!ta || !stage) return;

    const raw = ta.value.trim();
    if (!raw) {
      stage.innerHTML = ''; batch = [];
      say('batchStatus', '학생 정보를 입력해 주세요.', 'err');
      return;
    }

    const { list, warn } = parseBatch(raw);
    batch = list;

    if (!list.length) {
      stage.innerHTML = '';
      say('batchStatus', warn[0] || '읽을 수 있는 줄이 없습니다.', 'err');
      return;
    }

    stage.innerHTML = list.map(d => Report.render(d)).join('');

    const tc = {};
    list.forEach(s => { const k = SCHOOL_TYPES[s.schoolType].short; tc[k] = (tc[k] || 0) + 1; });
    const detail = Object.entries(tc).map(([k, v]) => `${k} ${v}명`).join(' · ');
    const n = currentOffered().length;
    const offMsg = n ? ` · 개설 과목 ${n}개 반영` : ' · 개설 과목 미반영(추정)';

    say('batchStatus',
      `${list.length}명 · ${list.length * 3}쪽 (${detail})${offMsg}` +
      (warn.length ? ` · 확인 필요 ${warn.length}건` : ''),
      warn.length ? 'warn' : 'ok');

    if (warn.length) console.warn('[batch]', warn);
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function printBatch() {
    if (!batch.length) runBatch();
    if (!batch.length) return;
    document.body.classList.add('print-batch');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('print-batch'), 500);
    }, 200);
  }

  function fillSample() {
    const ta = $('batchInput');
    if (!ta) return;
    ta.value = [
      '김서연, 20301, 2, ai, big, 88, 14, 70, 6, 80, mid, general, 80',
      '박준호, 20302, 2, sci, big, 95, 10, 85, 8, 90, high, science, 90',
      '이하늘, 20303, 2, intl, mid, 76, 11, 65, 5, 75, mid, foreign, 65',
      '정유진, 20304, 2, music, mid, 70, 9, 72, 4, 70, mid, art, 70',
      '최민서, 20305, 2, sport, rural, 62, 16, 55, 3, 60, low, sports, 50',
      '한지우, 20306, 2, edu, rural, 48, 14, 40, 3, 35, low, general, 35'
    ].join('\n');
    say('batchStatus', '예시 6명을 채웠습니다. 일괄 생성을 눌러 주세요.', 'ok');
    saveForm();
  }

  function reset() {
    if (!confirm('입력한 내용을 모두 지울까요?')) return;
    FORM_IDS.forEach(id => { const el = $(id); if (el && el.tagName !== 'SELECT') el.value = ''; });
    const ta = $('batchInput'); if (ta) ta.value = '';
    const stage = $('batchStage'); if (stage) stage.innerHTML = '';
    batch = []; window.__autoLoaded = false;
    coopRows = []; infraChecked = new Set(); creditChecked = new Set();
    saveCoop(); saveChecklist(LS_INFRA, infraChecked); saveChecklist(LS_CREDIT, creditChecked);
    renderCoopTable();
    renderChecklist('infraList', INFRA_QUESTIONS, infraChecked, 'infraSum', LS_INFRA);
    renderChecklist('creditList', CREDIT_QUESTIONS, creditChecked, 'creditSum', LS_CREDIT);
    setVal('fDate', today());
    const wIn = $('fWant'); if (wIn) wIn.readOnly = false;
    try { localStorage.removeItem(LS_FORM); } catch (e) {}
    say('batchStatus', ''); say('lookupState', ''); say('cfgState', '');
    updateFitDisplay(collect());
    clearPreview();
  }

  function bind() {
    FORM_IDS.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderSoon);
    });

    on('fOffered', 'input', () => { window.__autoLoaded = false; });
    on('batchInput', 'input', () => { clearTimeout(timer); timer = setTimeout(saveForm, 400); });

    on('btnRender', 'click', renderOne);
    on('btnPrint', 'click', () => { renderOne(); setTimeout(() => window.print(), 200); });
    on('btnReset', 'click', reset);
    on('btnLookup', 'click', lookup);
    on('btnSaveCfg', 'click', saveCfg);
    on('fKey', 'input', onCfgInput);
    on('fProxy', 'input', onCfgInput);
    on('btnSample', 'click', fillSample);
    on('btnBatch', 'click', runBatch);
    on('btnBatchPrint', 'click', printBatch);
    on('btnCoopAdd', 'click', addCoopRow);

    const sn = $('fSchoolName');
    if (sn) sn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); lookup(); }
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault(); renderOne();
        setTimeout(() => window.print(), 150);
      }
    });
  }

  function boot() {
    if (typeof SCHOOL_TYPES === 'undefined' || typeof TRACKS === 'undefined'
        || typeof Report === 'undefined') {
      const box = previewBox() || document.body;
      box.innerHTML = '<p style="padding:24px;color:#b91c1c;font-size:14px">' +
        'data.js 또는 report.js가 로드되지 않았습니다.<br>' +
        'index.html에서 data.js → report.js → neis.js → app.js 순서인지 확인해 주세요.</p>';
      console.error('[app.js] data.js / report.js must load first');
      return;
    }

    ensureUI();
    initSelects();
    initChecklists();
    loadCfg();
    renderKeyChip();
    loadForm();
    bind();
    updateFitDisplay(collect());
    clearPreview();

    console.info('[app.js] ready ·',
      Object.keys(TRACKS).length, 'tracks ·',
      Object.keys(SCHOOL_TYPES).length, 'school types');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.HCS = {
    renderOne, runBatch, collect, ensureUI,
    getBatch: () => batch,
    getSchool: () => PICKED_SCHOOL,
    setSchool: saveSchool
  };
})();
