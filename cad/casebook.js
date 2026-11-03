'use strict';

/** UI bridge สำหรับคลังเคสตัวอย่าง แยก Workspace กับเคสทดลอง  */

window.Casebook = (() => {
  const KEY = 'datapath-cad-casebook-v1';

  const galleryTitles = {
    'same-circuit': 'จัดวางวงจรใหม่ โดยผลลัพธ์ไม่เปลี่ยน',
    'operand-selector': 'เพิ่มทางเลือกข้อมูลเข้า ALU ด้วย MUX',
    'swapped-operands': 'ต่ออินพุต ALU สลับด้าน',
    'bypass-aluout': 'เขียนผลผิดรอบ เพราะข้าม ALUOut',
    'pc-plus-eight': 'PC เพิ่มผิด ทำให้ข้ามคำสั่ง',
    'unconditional-branch': 'Branch กระโดดทั้งที่เงื่อนไขไม่ผ่าน',
    'load-wrong-register': 'โหลดข้อมูลเข้า Register ผิดตัว',
    'memory-disabled': 'อ่าน Memory ไม่ได้ เพราะปิด MemRead',
    'index-is-not-data': 'ต่อบัสผิดชนิดและขนาดบิต',
    'combinational-feedback': 'วงจรป้อนกลับที่คำนวณต่อไม่ได้',
    'missing-offset-shift': 'Branch ไปผิด Address เพราะหน่วยไม่ตรง',
    'false-forwarding': 'Bypass เลือกข้อมูลผิด cycle',
    'shared-memory-prefetch': 'Fetch กับ Load แย่งพอร์ต Memory'
  };

  const galleryKinds = {
    good: 'ผลลัพธ์เดิม',
    tradeoff: 'มีข้อแลกเปลี่ยน',
    broken: 'วิเคราะห์ข้อผิดพลาด',
    hazard: 'ศึกษา Hazard'
  };

  const kinds = {
    all: 'ทั้งหมด',
    good: 'ทำงานถูก',
    tradeoff: 'มีข้อแลกเปลี่ยน',
    broken: 'เกิดปัญหา',
    hazard: 'เข้าใจ Hazard'
  };

  let session = null;
  let archivedDrafts = {};
  let filter = 'all';
  let cachedKey = '';
  let cachedBase = null;
  let originalHistory = null;

  const clone = Circuit.clone;

  /** บันทึกสถานะวงจร รหัส และสภาวะปัจจุบันออกเป็น */
  const snapshot = () => ({
    graph: clone(graph),
    program: code,
    initial,
    preset,
    cursor,
    mode
  });

  /** ตรวจความถูกต้องและปรับรูปแบบข้อมูล Snapshot  */
  function validateSnapshot(s) {
    if (
      !s ||
      typeof s.program !== 'string' ||
      s.program.length > 50000 ||
      typeof s.initial !== 'string' ||
      s.initial.length > 20000
    ) {
      throw Error('Invalid case snapshot');
    }
    return {
      ...s,
      graph: Circuit.fromJSON(s.graph),
      cursor: Number.isSafeInteger(s.cursor) && s.cursor >= 0 ? s.cursor : 0,
      mode: s.mode === 'edit' ? 'edit' : 'learn'
    };
  }

  /** คืนค่าสถานะวงจรและเครื่องมือจาก Snapshot */
  function restore(s) {
    stop();
    graph = clone(s.graph);
    code = s.program;
    initial = s.initial;
    preset = s.preset in PRESETS ? s.preset : 'custom';
    cursor = s.cursor || 0;
    mode = s.mode === 'edit' ? 'edit' : 'learn';
    selection = null;
    pending = null;
    tool = select;
    undoStack = [];
    redoStack = [];
  }

  /** บันทึกข้อมูล Session ลง localStorage */
  function rawSave() {
    try {
      if (session) {
        localStorage.setItem(KEY, JSON.stringify(session));
      } else if (Object.keys(archivedDrafts).length) {
        localStorage.setItem(KEY, JSON.stringify({ version: 1, active: false, drafts: archivedDrafts }));
      } else {
        localStorage.removeItem(KEY);
      }
    } catch {
      toast('พื้นที่บันทึกเต็ม: ใช้ไฟล์ → Export JSON เพื่อเก็บงานทดลอง');
    }
  }

  /** จำสถานะด่างๆ ของเคสปัจจุบันไว้ในร่าง */
  function remember() {
    if (session?.variant === 'modified') {
      session.drafts[session.id] = snapshot();
    }
  }

  /** ตรวจสอบการเปลี่ยนแปลงและสั่งบันทึกสถานะล่าสุดลง Storage */
  function persist() {
    if (!session) return;
    if (session.variant === 'base') {
      const draft = session.drafts[session.id];
      if (
        JSON.stringify(graph) !== JSON.stringify(Circuit.baseline()) ||
        code !== draft.program ||
        initial !== draft.initial
      ) {
        session.variant = 'modified';
      }
    }
    session.viewCursor = cursor;
    remember();
    rawSave();
  }

  /** จำลองการทำงานของวงจรต้นแบบพร้อมระบบ Caching */
  function baseResult() {
    const key = code + '\0' + initial;
    if (key !== cachedKey) {
      cachedKey = key;
      cachedBase = NetSim.simulate(Circuit.baseline(), code, initial);
    }
    return cachedBase;
  }

  /** จำลองการทำงานของวงจรที่ถูกแก้ไข */
  function editedResult() {
    if (session.variant === 'modified') return simulation;
    const d = session.drafts[session.id];
    return NetSim.simulate(d.graph, d.program, d.initial);
  }

  /** เช็คว่าเคสถูกแก้ไขให้ต่างไปจากค่าเริ่มต้นมั้ย */
  function draftDiff(c) {
    const d = session.drafts[c.id];
    return (
      !!d &&
      (JSON.stringify(d.graph) !== JSON.stringify(CircuitCases.build(c.id)) ||
        d.program !== c.code ||
        d.initial !== c.initial)
    );
  }

  /** เปิดเข้าใช้งานเคสทดลองตาม ID ที่กำหนด */
  function enter(id) {
    const c = CircuitCases.get(id);
    if (!c) return;

    clearTimeout(toastTimer);
    $('#toast').classList.remove('visible');

    if (!session) {
      originalHistory = { undo: undoStack, redo: redoStack };
      session = {
        version: 1,
        id,
        variant: 'modified',
        panel: 'lesson',
        backup: snapshot(),
        drafts: clone(archivedDrafts)
      };
    } else {
      remember();
    }

    session.id = id;
    session.variant = 'modified';
    session.panel = 'lesson';

    if (!session.drafts[id]) {
      session.drafts[id] = {
        graph: CircuitCases.build(id),
        program: c.code,
        initial: c.initial,
        preset: 'custom',
        cursor: c.focus,
        mode: 'learn'
      };
    }

    restore(session.drafts[id]);
    mode = 'learn';
    save();
    recalculate();
    fit();

    $('#inspector').scrollTop = 0;
    if (innerWidth <= 600) window.scrollTo(0, 0);
    rawSave();

    const url = new URL(location.href);
    url.hash = 'case=' + id;
    history.replaceState(null, '', url);
  }

  /** สลับการแสดงผลระหว่างวงจรต้นแบบ(Base) และวงจรที่แก้ไข(Modified) */
  function compare(variant) {
    if (!session || session.variant === variant) return;
    const position = cursor;
    remember();
    session.variant = variant;

    if (variant === 'base') {
      const d = session.drafts[session.id];
      restore({ ...d, graph: Circuit.baseline(), cursor: position, mode: 'learn' });
    } else {
      restore({ ...session.drafts[session.id], cursor: position });
    }

    save();
    recalculate();
    fit();
    rawSave();
  }

  /** ออกจากระบบเคสทดลอง สลับกลับไปยัง Workspace เดิม */
  function leave() {
    if (!session) return;
    const backup = session.backup;
    remember();
    archivedDrafts = clone(session.drafts);
    restore(backup);
    session = null;
    rawSave();

    if (originalHistory) {
      undoStack = originalHistory.undo;
      redoStack = originalHistory.redo;
      originalHistory = null;
    }

    save();
    recalculate();
    fit();
    history.replaceState(null, '', location.pathname + location.search);
    toast('กลับมาที่งานเดิมแล้ว · งานทดลองแต่ละเคสยังเก็บไว้');
  }

  /** รีเซ็ตเคสปัจจุบันกลับเป็นค่าเริ่มต้นเดิม */
  function reset() {
    if (!session) return;
    const c = CircuitCases.get(session.id);
    const before = clone(graph);
    graph = CircuitCases.build(c.id);
    code = c.code;
    initial = c.initial;
    preset = 'custom';
    cursor = c.focus;
    selection = null;
    session.variant = 'modified';
    session.panel = 'lesson';
    commit(before, 'เริ่มเคสนี้ใหม่แล้ว');
    fit();
  }

  /** ตรวจสอบว่าวงจรพร้อมสำหรับการแก้ไข */
  function ensureEditable() {
    if (session?.variant === 'base') {
      compare('modified');
      toast('กลับไปแก้วงจรทดลอง · ต้นแบบเก็บไว้สำหรับเปรียบเทียบ');
    }
  }

  /** สร้างภาพ SVG ตัวอย่างของวงจรในแต่ละเคส */
  function casePreview(c) {
    const g = CircuitCases.build(c.id);
    const focus = g.nodes.find(n => n.id === c.nodes[0]) || g.nodes[0];
    const d = Circuit.definitions[focus.type];
    const cx = focus.x + d.w / 2;
    const cy = focus.y + d.h / 2;

    // ครอปเฉพาะบริเวณโหนดที่มีการเปลี่ยนแปลง
    const wires = g.wires
      .map(
        w =>
          `<path d="${pathOf(Circuit.orthogonal(g, w))}" class="preview-wire ${
            c.wires.includes(w.id) ? 'highlight' : ''
          }"/>`
      )
      .join('');

    const nodes = g.nodes
      .map(n => {
        const def = Circuit.definitions[n.type];
        const showLabel = !['and', 'or', 'concat'].includes(n.type) && (c.nodes.includes(n.id) || def.w >= 60);
        const lines = String(n.type === 'constant' ? n.value : n.label).split(' ');
        const label = showLabel
          ? lines
              .map((line, i) =>
                text(def.w / 2, def.h / 2 + 5 + (i - (lines.length - 1) / 2) * 16, line, 'preview-label')
              )
              .join('')
          : '';
        return `<g transform="translate(${n.x},${n.y})" class="preview-node ${
          c.nodes.includes(n.id) ? 'highlight' : ''
        }">${componentShape(n)}${label}</g>`;
      })
      .join('');

    return `<svg class="case-preview" viewBox="${cx - 280} ${
      cy - 165
    } 560 330" aria-hidden="true">${wires}${nodes}</svg>`;
  }

  /** แสดง Modal คลังเคสตัวอย่างทั้งหมด*/
  function gallery() {
    remember();
    rawSave();
    const subset = CircuitCases.all.filter(c => filter === 'all' || c.kind === filter);

    const body = `<div class="gallery-overview"><span>เลือกปัญหาที่อยากเข้าใจ แล้วดูจุดที่เปลี่ยนในวงจร</span><span class="gallery-count">${
      subset.length
    } วงจรทดลอง</span></div><div class="case-grid">${subset
      .map(
        c =>
          `<button type="button" class="case-card" data-case-open="${c.id}" aria-labelledby="gallery-title-${
            c.id
          }" aria-describedby="gallery-desc-${c.id}"><span class="gallery-card-meta"><span class="gallery-case-id">CASE ${String(
            c.number
          ).padStart(2, '0')}</span><span class="gallery-kind ${c.kind}">${E(
            galleryKinds[c.kind] || kinds[c.kind]
          )}</span></span><span class="gallery-card-copy"><span class="gallery-card-title" id="gallery-title-${
            c.id
          }">${E(galleryTitles[c.id] || c.title)}</span><span class="gallery-card-description" id="gallery-desc-${
            c.id
          }">${E(c.title)}</span></span><span class="gallery-card-image">${casePreview(
            c
          )}</span><span class="gallery-card-footer"><span>เปิดวงจรและดูการทำงาน</span><span class="gallery-card-arrow" aria-hidden="true">↗</span></span></button>`
      )
      .join('')}</div>`;

    const el = dialog('ตัวอย่างวงจร', 'สำรวจปัญหา ทดลองแก้ และเทียบผลกับวงจรต้นแบบ', body, true);
    el.classList.add('case-gallery', 'case-gallery-v2');
    el.setAttribute('aria-label', 'คลังตัวอย่างวงจร 13 เคส');
  }

  /** ดึงค่าสัญญาณของโหนดออกมาแสดงผลในตารางเปรียบเทียบ */
  function showValue(result, index, probe) {
    const value = CircuitCases.read(result, index, probe.path);
    return value === undefined
      ? '<span class="case-no-value">หยุดก่อนรอบนี้</span>'
      : probe.hex
      ? CPU.hex(value)
      : String(value | 0);
  }

  /** สร้างโครงสร้าง HTML หน้าบทเรียน ตารางเปรียบเทียบผลลัพธ์ของเคส */
  function lesson(c) {
    const b = baseResult();
    const r = editedResult();
    const focus = Math.min(cursor, Math.max(b.frames.length, r.frames.length) - 1);
    const sf = simulation.frames[cursor];

    const probes = [c.probe];
    if (c.probe.path.join('.') !== 'after.pc') {
      probes.push({ label: 'PC หลัง clock', path: ['after', 'pc'], hex: true });
    }

    const changed = draftDiff(c);
    const issue = r.issues[0];

    return `<div class="case-lesson"><div class="case-lesson-heading"><span class="case-overline">CASE ${String(
      c.number
    ).padStart(2, '0')}</span><span class="case-tag ${c.kind}">${
      kinds[c.kind]
    }</span></div><h2>${E(c.title)}</h2><p class="case-lesson-summary">${E(c.summary)}</p>${
      changed
        ? '<div class="case-edited">คุณแก้ตัวอย่างเพิ่มแล้ว · ตารางเทียบคำนวณจากงานปัจจุบัน คำอธิบายด้านล่างเล่าการทดลองตั้งต้น</div>'
        : ''
    }<div class="case-actions"><button data-case-focus class="button primary">ไปจุดชี้ขาด · C${
      c.focus + 1
    }</button><button data-case-points class="button">ดูจุดที่แก้ ↗</button></div><div class="case-compare"><div class="case-section-label">ผลหลัง clock <span>${
      sf ? 'CYCLE ' + (cursor + 1) + ' · STATE ' + sf.state : 'ยังจำลองไม่ได้'
    }</span></div><table><thead><tr><th>ค่าที่ตรวจ</th><th>ต้นแบบ</th><th>แก้แล้ว</th></tr></thead><tbody>${probes
      .map(
        p =>
          `<tr><th>${E(p.label)}</th><td>${showValue(b, focus, p)}</td><td class="${
            CircuitCases.read(b, focus, p.path) !== CircuitCases.read(r, focus, p.path) ? 'different' : ''
          }">${showValue(r,focus,p)}</td></tr>`
      )
      .join('')}</tbody></table><small>โปรแกรมเดียวกัน • cycle ลำดับเดียวกัน${
      b.frames[focus]?.before.irAddress !== r.frames[focus]?.before.irAddress && r.frames[focus]
        ? ' • คำสั่งที่กำลังทำต่างกันเพราะเส้นทาง PC เปลี่ยน'
        : ''
    }</small></div>${
      issue
        ? `<div class="case-diagnostic"><b>วงจรแก้หยุดตรงนี้</b><p>${E(
            issue.message
          )}</p><button data-case-signals>ดูรายละเอียด / เลือกจุดซ่อม ↗</button></div>`
        : ''
    }<section><h3>แก้อะไร</h3><p>${E(c.change)}</p></section><div class="case-route lesson-route">${c.route
      .map(t => `<span>${E(t)}</span>`)
      .join('<i>↓</i>')}</div><section><h3>ไล่จังหวะสำคัญ</h3><ol class="case-steps">${c.steps
      .map(([h, p]) => `<li><b>${E(h)}</b><p>${E(p)}</p></li>`)
      .join('')}</ol></section><section><h3>ทำไมผลจึงเป็นแบบนี้</h3><p>${E(
      c.why
    )}</p></section>${
      c.caveat ? `<div class="case-boundary"><b>ขอบเขตของการทดลอง</b><p>${E(c.caveat)}</p></div>` : ''
    }<div class="case-takeaway"><b>จำหลักนี้ไว้</b><p>${E(
      c.takeaway
    )}</p></div><details class="case-experiment"><summary>ลองแก้ต่อด้วยตัวเอง</summary><p>${E(
      c.experiment
    )}</p><button data-case-edit class="button primary">เปิด Edit แล้วทดลอง ↗</button></details><details class="case-program"><summary>คำสั่งและค่าเริ่มต้นของเคส</summary><pre>${E(
      c.code
    )}</pre><pre>${E(
      c.initial
    )}</pre></details><div class="case-source-note">อ้างอิง <a href="../sources/FE2019b.pdf#page=4" target="_blank" rel="noopener">FE2019b รูป 2 ↗</a> · <a href="../sources/FE2019b.pdf#page=5" target="_blank" rel="noopener">ตาราง 3–4 ↗</a>${
      c.sourceNotes
        ? ` · <a href="../sources/COANotes2014.pdf#page=${c.sourceNotes}" target="_blank" rel="noopener">COANotes §5.1 ↗</a>`
        : ''
    }<br>สูตรดัดแปลงและผลทดลองจัดทำเพื่ออธิบายวงจร ไม่ใช่เฉลยต้นฉบับ</div></div>`;
  }

  /** ไฮไลต์ส่วนประกอบใน Canvas */
  function mark(c) {
    $('#drawing').querySelectorAll('.case-halo').forEach(n => n.remove());
    $('#drawing').querySelectorAll('.case-node').forEach(n => n.classList.remove('case-node'));

    if (session.variant === 'base') return;

    for (const id of c.wires) {
      const hit = [...$('#drawing').querySelectorAll('[data-wire]')].find(n => n.dataset.wire === id);
      if (!hit) continue;
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      halo.setAttribute('d', hit.getAttribute('d'));
      halo.setAttribute('class', 'case-halo');
      hit.parentNode.prepend(halo);
    }

    for (const id of c.nodes) {
      const node = [...$('#drawing').querySelectorAll('[data-node]')].find(n => n.dataset.node === id);
      node?.classList.add('case-node');
    }
  }

  /** อัปเดตการแสดงผลของ UI แถบเครื่องมือเคส หน้าต่าง Inspector */
  function decorate() {
    const bar = $('#case-bar');
    if (!session) {
      bar.hidden = true;
      document.body.classList.remove('case-active');
      return;
    }

    document.body.classList.add('case-active');
    bar.hidden = false;

    const c = CircuitCases.get(session.id);
    bar.innerHTML = `<button data-case-gallery class="case-library-back" title="เลือกเคสอื่น">▦ <span>คลังเคส</span></button><div class="case-bar-title"><span>CASE ${String(
      c.number
    ).padStart(2, '0')}</span><strong>${E(c.title)}</strong></div><div class="case-variants" role="group" aria-label="เปรียบเทียบวงจร"><button data-case-variant="base" class="${
      session.variant === 'base' ? 'active' : ''
    }" aria-pressed="${session.variant === 'base'}">ต้นแบบ</button><button data-case-variant="modified" class="${
      session.variant === 'modified' ? 'active' : ''
    }" aria-pressed="${session.variant === 'modified'}">วงจรแก้</button></div><span class="case-hint"><i></i>จุดที่เคสนี้ใช้</span><button data-case-reset title="คืนวงจรและคำสั่งตั้งต้นของเคส">เริ่มเคสใหม่</button><button data-case-leave class="case-return">กลับงานของฉัน ↗</button>`;

    const panel = $('#inspector');
    const show = session.panel === 'lesson' && !selection;

    if (show) panel.innerHTML = lesson(c);

    panel.insertAdjacentHTML(
      'afterbegin',
      `<div class="case-pane-tabs" role="group" aria-label="รายละเอียดตัวอย่าง"><button data-case-lesson class="${
        show ? 'active' : ''
      }" aria-pressed="${show}">บทเรียนของเคส</button><button data-case-signals class="${
        !show ? 'active' : ''
      }" aria-pressed="${!show}">ค่า cycle / อุปกรณ์</button></div>`
    );

    mark(c);
  }

  /** ซูมและเลื่อนมุมมองไปยังจุดสำคัญที่เคสเน้นย้ำ */
  function focusPoints() {
    const c = CircuitCases.get(session.id);
    const points = c.nodes.map(id => graph.nodes.find(n => n.id === id)).filter(Boolean);
    if (!points.length) return;

    const x = Math.min(...points.map(n => n.x)) - 150;
    const y = Math.min(...points.map(n => n.y)) - 100;
    let w = Math.max(...points.map(n => n.x + Circuit.definitions[n.type].w)) - x + 150;
    let h = Math.max(...points.map(n => n.y + Circuit.definitions[n.type].h)) - y + 100;

    const box = $('#scene').getBoundingClientRect();
    const ratio = box.width / box.height;

    w = Math.max(w, 600);
    if (w / h < ratio) w = h * ratio;
    else h = w / ratio;

    camera = { x, y, w, h };
    updateCamera();
  }

  /** เริ่มต้นการทำงาน โหลดข้อมูลจาก Storage ผูก Event Listeners และตรวจสอบ URL Hash */
  function init() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.version === 1 && saved.active === false) {
        for (const [id, s] of Object.entries(saved.drafts)) {
          if (!CircuitCases.get(id)) throw Error('Invalid case id');
          archivedDrafts[id] = validateSnapshot(s);
        }
      } else if (
        saved?.version === 1 &&
        CircuitCases.get(saved.id) &&
        ['base', 'modified'].includes(saved.variant)
      ) {
        saved.backup = validateSnapshot(saved.backup);
        for (const [id, s] of Object.entries(saved.drafts)) {
          if (!CircuitCases.get(id)) throw Error('Invalid case id');
          saved.drafts[id] = validateSnapshot(s);
        }

        if (!saved.drafts[saved.id]) throw Error('Missing case draft');
        session = saved;
        session.panel = 'lesson';

        if (session.variant === 'modified') {
          restore(session.drafts[session.id]);
        } else {
          const d = session.drafts[session.id];
          restore({ ...d, graph: Circuit.baseline(), cursor: session.viewCursor ?? d.cursor, mode: 'learn' });
        }
      }
    } catch {
      session = null;
      toast('อ่านคลังงานทดลองที่เก็บไว้ไม่ได้ งานวงจรปัจจุบันยังเปิดอยู่');
    }

    const linked = new URLSearchParams(location.hash.slice(1)).get('case');
    if (CircuitCases.get(linked) && linked !== session?.id) {
      enter(linked);
    } else {
      recalculate();
      fit();
    }

    // Event Delegation สำหรับจัดการการคลิกปุ่มต่างๆ ใน UI
    document.addEventListener('click', event => {
      const b = event.target.closest('button');
      if (!b) return;

      if (b.id === 'open-cases' || b.hasAttribute('data-case-gallery')) gallery();
      if (b.dataset.caseFilter) {
        filter = b.dataset.caseFilter;
        gallery();
      }
      if (b.dataset.caseOpen) {
        $('dialog')?.close();
        enter(b.dataset.caseOpen);
      }
      if (b.dataset.caseVariant) compare(b.dataset.caseVariant);
      if (b.hasAttribute('data-case-leave')) leave();
      if (b.hasAttribute('data-case-reset')) reset();
      if (b.hasAttribute('data-case-lesson') && session) {
        session.panel = 'lesson';
        selection = null;
        render();
        rawSave();
      }
      if (b.hasAttribute('data-case-signals') && session) {
        session.panel = 'signals';
        render();
        rawSave();
      }
      if (b.hasAttribute('data-case-focus') && session) {
        selection = null;
        changeCycle(CircuitCases.get(session.id).focus);
      }
      if (b.hasAttribute('data-case-points') && session) focusPoints();
      if (b.hasAttribute('data-case-edit') && session) {
        ensureEditable();
        session.panel = 'signals';
        setMode('edit');
      }
    });

    window.addEventListener('pagehide', persist);
    window.addEventListener('hashchange', () => {
      const id = new URLSearchParams(location.hash.slice(1)).get('case');
      if (CircuitCases.get(id) && id !== session?.id) enter(id);
    });
  }

  return {
    init,
    decorate,
    persist,
    ensureEditable,
    open: gallery,
    enter,
    leave
  };
})();

// เรียกการทำงานเริ่มต้น
Casebook.init();
