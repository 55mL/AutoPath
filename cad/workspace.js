/* workspace.js ui ทั้งหมด*/
'use strict';

/**
 * ฟังก์ชันผู้ช่วยดึง DOM Element ตัวเดียวตาม Selector
 */
const $ = s => document.querySelector(s);

/**
 * ฟังก์ชันผู้ช่วยดึง DOM Elements ทั้งหมดเป็น Array ตาม Selector
 */
const $$ = s => [...document.querySelectorAll(s)];

/**
 * ฟังก์ชันแปลงอักขระพิเศษ HTML ให้ปลอดภัยจากการทำ XSS Injection
 */
const E = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c])
  );

/** ชุดโปรแกรม MIPS สำเร็จรูปที่เตรียมไว้ให้เลือกใช้ */
const PRESETS = {
  lw: 'lw $s0, 0($s5)',
  sw: 'sw $t0, 4($s5)',
  add: 'add $s0, $t0, $t1',
  beq: 'beq $t0, $t0, target\nadd $s0, $t0, $t1\ntarget: sub $s1, $t0, $t1',
  j: 'j target\nadd $s0, $t0, $t1\ntarget: and $s1, $t0, $t1'
};

/** สภาวะเริ่มต้นของ Register และ Memory */
const DEFAULT_INIT = '$s5=256\n$t0=5\n$t1=3\n[256]=42\n[260]=7';

/** คีย์สำหรับบันทึกข้อมูล Workspace ลง localStorage */
const STORE = 'datapath-cad-workspace-v1';

let graph = Circuit.baseline();
let code = PRESETS.lw;
let initial = DEFAULT_INIT;
let preset = 'lw';
let mode = 'learn';
let tool = 'select';
let selection = null;
let simulation = null;
let cursor = 0;
let timer = null;
let pending = null;
let drag = null;
let space = false;

let camera = { x: -65, y: -55, w: 1545, h: 880 };
let fittedWidth = 1545;
let undoStack = [];
let redoStack = [];
let toastTimer = null;
let storageEnabled = true;

try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) {
    graph = Circuit.fromJSON(saved.graph);
    if (typeof saved.program === 'string' && saved.program.length <= 50000) {
      code = saved.program;
    }
    if (typeof saved.initial === 'string' && saved.initial.length <= 20000) {
      initial = saved.initial;
    }
    preset = saved.preset in PRESETS ? saved.preset : 'custom';
  }
} catch {
  storageEnabled = false;
}

/** ดึงข้อมูล Frame จำลองปัจจุบันตามตำแหน่ง Cursor */
const frame = () => simulation?.frames[cursor];

/** ตรวจสอบว่าวงจรปัจจุบันแตกต่างไปจากวงจรต้นแบบเดิมหรือไม่ */
const isCustom = () => {
  const base = Circuit.baseline();
  return (
    JSON.stringify(graph.nodes) !== JSON.stringify(base.nodes) ||
    JSON.stringify(graph.wires) !== JSON.stringify(base.wires) ||
    Object.keys(graph.controlOverrides || {}).length > 0
  );
};

/** แสดงข้อความแจ้งเตือนสั้นๆ (Toast Notification) */
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3800);
}

/** บันทึกสถานะปัจจุบันของวงจรและโค้ดลง localStorage */
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ graph, program: code, initial, preset }));
    window.Casebook?.persist();
    storageEnabled = true;
    if ($('#save-state')) $('#save-state').innerHTML = '<i></i>บันทึกในเครื่องแล้ว';
  } catch {
    storageEnabled = false;
    if ($('#save-state')) $('#save-state').textContent = 'ใช้ Export เพื่อเก็บงาน';
    toast('บันทึกอัตโนมัติไม่ได้ ใช้ไฟล์ → Export JSON เพื่อเก็บงาน');
  }
}

/** หยุดการเล่นจำลองแบบอัตโนมัติ */
function stop() {
  clearInterval(timer);
  timer = null;
  $('#play').textContent = '▶';
  $('#play').setAttribute('aria-label', 'เล่นการจำลอง');
}

/** คำนวณผลจำลองการทำงานของวงจรใหม่ทั้งหมด */
function recalculate(preserve = true) {
  stop();
  simulation = NetSim.simulate(graph, code, initial);
  cursor = preserve ? Math.min(cursor, Math.max(0, simulation.frames.length - 1)) : 0;
  render();
}

/** ยืนยันการเปลี่ยนแปลง พร้อมบันทึกประวัติ Undo/Redo */
function commit(before, message) {
  undoStack.push(before);
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  pending = null;
  save();
  recalculate();
  if (message) toast(message);
}

/** ทำการปรับแต่งวงจรผ่าน Callback และสั่งบันทึกประวัติ */
function mutate(fn, message) {
  const before = Circuit.clone(graph);
  fn();
  commit(before, message);
}

/** เลิกทำรายการล่าสุด (Undo) */
function undo() {
  if (!undoStack.length) return;
  redoStack.push(Circuit.clone(graph));
  graph = undoStack.pop();
  selection = null;
  pending = null;
  save();
  recalculate();
  toast('ย้อนกลับแล้ว');
}

/** ทำซ้ำรายการที่ยกเลิก (Redo) */
function redo() {
  if (!redoStack.length) return;
  undoStack.push(Circuit.clone(graph));
  graph = redoStack.pop();
  selection = null;
  pending = null;
  save();
  recalculate();
  toast('ทำซ้ำแล้ว');
}

/** สลับโหมดการทำงานระหว่าง Edit และ Learn */
function setMode(value) {
  if (value === 'edit') window.Casebook?.ensureEditable();
  stop();
  mode = value;
  tool = 'select';
  pending = null;
  selection = null;
  render();
  toast(
    mode === 'edit'
      ? 'ลากอุปกรณ์เพื่อย้าย · กด W เพื่อต่อสาย · Ctrl Z ย้อนกลับ'
      : 'เลือก cycle เพื่อดูค่าที่วิ่งผ่านวงจรนี้'
  );
}

/** สลับเครื่องมือวาดวงจร (Select / Wire / Pan) */
function setTool(value) {
  if (value === 'wire' && mode !== 'edit') {
    setMode('edit');
  }
  tool = value;
  pending = null;
  renderTools();
  renderOverlay();
}

/** สลับชุดโปรแกรมสำเร็จรูป (Preset) */
function switchPreset(key) {
  const state = frame()?.state || 0;
  code = PRESETS[key];
  preset = key;
  simulation = NetSim.simulate(graph, code, initial);
  cursor = Math.min(state, key === 'j' ? 1 : 2, Math.max(0, simulation.frames.length - 1));
  selection = null;
  stop();
  save();
  render();
}

/** เปลี่ยนไปยัง Cycle การทำงานที่กำหนด */
function changeCycle(n) {
  stop();
  cursor = Math.max(0, Math.min(n, (simulation?.frames.length || 1) - 1));
  render();
}

/** คำนวณจำนวน Cycle รวมของคำสั่งปัจจุบัน */
function instructionLength() {
  const f = frame();
  if (!f) return 3;
  const start = cursor - f.state;
  for (let i = start; i < Math.min(start + 3, simulation.frames.length); i++) {
    if (simulation.frames[i].nextState === 0) return i - start + 1;
  }
  return 3;
}

/** ดึงรายการ State ทั้งหมดของคำสั่งที่กำลังรันอยู่ */
function currentStates() {
  const f = frame();
  if (!f) return [0, 1, 2].map(s => ({ state: s, index: -1 }));
  const start = cursor - f.state;
  const total = instructionLength();
  return [0, 1, 2].map(s => ({
    state: s,
    index: s < total && simulation.frames[start + s]?.state === s ? start + s : -1
  }));
}

/** อัปเดตและเรนเดอร์ UI ทั้งหมดของแอปพลิเคชัน */
function render() {
  renderTools();
  syncCodePane();
  renderBoard();
  renderInspector();
  renderTimeline();
  $('#current-instruction').textContent = frame()?.inst.text || 'ตรวจวงจรก่อนเริ่มจำลอง';
  $('#presets').innerHTML = Object.keys(PRESETS)
    .map(k => `<button data-preset="${k}" class="${preset === k ? 'active' : ''}">${k}</button>`)
    .join('');
  const custom = isCustom();
  $('#design-badge').textContent = custom ? 'CUSTOM CIRCUIT' : 'BASE CIRCUIT';
  $('#design-badge').classList.toggle('custom', custom);
  $('#counts').textContent = `${graph.nodes.length} components · ${graph.wires.length} wires`;
  $('#health').textContent = simulation?.issues.length
    ? `${simulation.issues.length} จุดที่ต้องตรวจ`
    : '● วงจรพร้อมใช้งาน';
  $('#health').classList.toggle('invalid', !!simulation?.issues.length);
  $('#mode-status').textContent =
    mode === 'edit'
      ? 'Edit · แก้สายแล้วจำลองตามวงจรจริง'
      : 'Learn · สายก่อน clock / ผลหลัง clock';
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
  $$('[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', b.dataset.mode === mode);
  });
  $('#add-node').disabled = mode !== 'edit';
  if (mode !== 'edit') closeLibrary();
  document.body.classList.toggle('edit-mode', mode === 'edit');
  window.Casebook?.decorate();
}

/** อัปเดตสถานะปุ่มเครื่องมือวาดภาพและข้อความคำแนะนำ */
function renderTools() {
  $$('button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  $('#scene').dataset.tool = space ? 'pan' : tool;
  $('#canvas-hint').textContent = pending
    ? 'เลือกขาปลายทาง · Esc ยกเลิก'
    : mode === 'edit'
    ? tool === 'wire'
      ? 'ลากจากขา output → input เพื่อต่อสาย'
      : 'ลากอุปกรณ์ · คลิกสายแล้วลากจุดมุม · Ctrl Z ย้อนกลับ'
    : 'ค่าบนสาย = ก่อน clock · ผลหลัง clock อยู่ด้านขวา';
}

/** ฟังก์ชันผู้ช่วยสร้าง SVG Text Node */
function text(x, y, t, cls = '', anchor = 'middle') {
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${E(t)}</text>`;
}

/** ฟังก์ชันผู้ช่วยแปลง Array จุดพิกัดให้เป็น SVG Path Data (d attribute) */
function pathOf(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
}

/** จำแนกประเภทของสายไฟ (สายควบคุม หรือ สายข้อมูล) */
function wireKind(w) {
  return Circuit.port(graph, w.to)?.kind === 'control' ? 'control' : 'data';
}

/** เรนเดอร์ผังวงจรไฟฟ้าและสายไฟทั้งหมดลงบน Canvas SVG */
function renderBoard() {
  const f = frame();
  const active = new Set(f?.active || []);
  const written = new Set(f?.written || []);
  const badWires = new Set(simulation?.issues.map(i => i.wire));
  const badNodes = new Set(simulation?.issues.map(i => i.node));

  let html = graph.wires
    .map(w => {
      const kind = wireKind(w);
      const points = Circuit.orthogonal(graph, w);
      if (points.length < 2) return '';
      const selected = selection?.type === 'wire' && selection.id === w.id;
      return `<g class="wire-group ${kind === 'control' ? 'control-group' : ''}"><path d="${pathOf(
        points
      )}" class="wire-hit" data-wire="${E(w.id)}"/><path d="${pathOf(points)}" class="net-wire ${kind} ${
        active.has(w.id) ? 'live' : ''
      } ${selected ? 'selected' : ''} ${
        badWires.has(w.id) ? 'invalid' : ''
      }" marker-end="url(#arrow-data)"/><title>${E(w.label || connectionName(w))}${
        f?.values[w.id] !== null && f?.values[w.id] !== undefined
          ? ' = ' + formatValue(f.values[w.id], Circuit.port(graph, w.to)?.bits)
          : ''
      }</title></g>`;
    })
    .join('');

  html += graph.nodes
    .map(n =>
      nodeSVG(n, {
        selected: selection?.type === 'node' && selection.id === n.id,
        written: written.has(n.id),
        invalid: badNodes.has(n.id)
      })
    )
    .join('');

  const ctrl = graph.nodes.find(n => n.type === 'control');
  if (ctrl) {
    html += Circuit.pins(ctrl)
      .filter(p => p.dir === 'out')
      .map(p => {
        const x = ctrl.x + p.x;
        const y = ctrl.y + p.y;
        const left = p.x < 42;
        const v = f?.controls[p.id];
        const live = graph.wires.some(
          w => w.from.node === ctrl.id && w.from.port === p.id && active.has(w.id)
        );
        return text(
          x + (left ? -10 : 10),
          y - 8,
          `${p.id}${v !== undefined ? ' = ' + v.toString(2).padStart(p.bits, '0') : ''}`,
          'wire-label control-wire-label ' + (live ? 'live' : ''),
          left ? 'end' : 'start'
        );
      })
      .join('');
  }

  if ($('#show-values').checked && f) {
    for (const n of graph.nodes) {
      let val;
      if (n.type === 'pc') val = CPU.hex(f.before.pc);
      if (n.type === 'latch') val = 'Q = ' + (f.before.latches[n.id] | 0);
      if (n.type === 'alu')
        val = f.portValues[n.id + '.zero'] !== undefined ? 'Zero = ' + f.portValues[n.id + '.zero'] : null;
      if (val != null) {
        html += text(
          n.x + Circuit.definitions[n.type].w / 2,
          n.y + Circuit.definitions[n.type].h + 20,
          val,
          'node-value'
        );
      }
    }
  }

  $('#drawing').innerHTML = html;
  $('#scene').classList.toggle('control-hidden', !$('#show-control').checked);
  renderOverlay();
  updateCamera();
}

/** สร้างภาพรูปร่าง SVG ของแต่ละอุปกรณ์ */
function componentShape(n) {
  const d = Circuit.definitions[n.type];
  const { w, h } = d;
  let shape = '';

  if (d.shape === 'rect' || d.shape === 'ir' || d.shape === 'registers') {
    shape = `<rect class="node-body" width="${w}" height="${h}" rx="2"/>`;
  }
  if (d.shape === 'mux') {
    shape = `<rect class="node-body" width="${w}" height="${h}" rx="${w / 2}"/>`;
  }
  if (d.shape === 'oval') {
    shape = `<ellipse class="node-body" cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
  }
  if (d.shape === 'alu') {
    shape = '<path class="node-body" d="M0 0L98 46V112L0 158V105L20 81L0 57Z"/>';
  }
  if (d.shape === 'and') {
    shape = `<path class="node-body" d="M44 0H18C-6 0-6 38 18 38H44Z"/>`;
  }
  if (d.shape === 'or') {
    shape = '<path class="node-body" d="M52 0Q34 19 52 38Q12 41 0 20Q12-2 52 0Z"/>';
  }
  if (d.shape === 'junction') {
    shape = '<circle class="junction-dot" cx="6" cy="6" r="4"/>';
  }
  if (d.shape === 'constant') {
    shape = `<rect class="node-body" width="${w}" height="${h}" rx="5"/>`;
  }
  if (d.shape === 'note') {
    shape = `<rect class="note-body" width="${w}" height="${h}" rx="5"/>`;
  }

  return shape;
}

/** สร้างภาพสัญลักษณ์ย่อสำหรับแสดงในเมนู Library */
function componentSymbol(type, glyph) {
  const n = Circuit.node(type, 'preview', 0, 0);
  const d = Circuit.definitions[type];
  const pins = Circuit.pins(n)
    .map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" class="symbol-pin"/>`)
    .join('');
  const label = ['and', 'or'].includes(type) ? '' : text(d.w / 2, d.h / 2 + 5, glyph, 'symbol-label');
  return `<svg class="component-symbol" viewBox="-14 -14 ${d.w + 28} ${
    d.h + 28
  }" aria-hidden="true">${componentShape(n)}${pins}${label}</svg>`;
}

/** สร้างโครงสร้าง SVG ของอุปกรณ์พร้อมป้ายกำกับและ Pin เชื่อมต่อ */
function nodeSVG(n, state) {
  const d = Circuit.definitions[n.type];
  const { w, h } = d;
  let shape = '';
  let labels = '';
  let extra = '';

  shape = componentShape(n);

  if (d.shape === 'mux') {
    labels +=
      text(w - 11, h / 2 - 12, 'M', 'node-small') +
      text(w - 11, h / 2 + 2, 'u', 'node-small') +
      text(w - 11, h / 2 + 16, 'x', 'node-small');
    Circuit.pins(n)
      .filter(p => /^i\d/.test(p.id))
      .forEach(p => (labels += text(9, p.y + 4, p.label, 'node-number')));
  } else if (n.type === 'ir') {
    Circuit.pins(n)
      .filter(p => ['opcode', 'rs', 'rt', 'imm', 'rd'].includes(p.id))
      .forEach(p => {
        labels += text(w - 10, p.y - 7, p.label.split(' ')[0], 'node-small', 'end');
        labels += text(w - 10, p.y + 7, p.id === 'imm' ? 'immediate' : p.id, 'node-port-label', 'end');
      });
    labels += text(17, 105, 'I', 'node-name') + text(17, 122, 'R', 'node-name');
  } else if (n.type === 'registers') {
    [
      ['rs', ['Read', 'register 1']],
      ['rt', ['Read', 'register 2']],
      ['dest', ['Write', 'register']],
      ['data', ['Write', 'data']]
    ].forEach(([id, lines]) => {
      const p = Circuit.pins(n).find(p => p.id === id);
      lines.forEach((t, i) => (labels += text(8, p.y - 4 + i * 13, t, 'node-port-label', 'start')));
    });
    [
      ['a', ['Read', 'data 1']],
      ['b', ['Read', 'data 2']]
    ].forEach(([id, lines]) => {
      const p = Circuit.pins(n).find(p => p.id === id);
      lines.forEach((t, i) => (labels += text(w - 8, p.y - 4 + i * 13, t, 'node-port-label', 'end')));
    });
    labels += text(w / 2, 100, n.label.slice(0, 16), 'node-name');
  } else if (n.type === 'memory') {
    labels +=
      text(w / 2, 72, n.label.slice(0, 16), 'node-name') +
      text(8, 39, 'Address', 'node-port-label', 'start') +
      text(w - 8, 97, 'MemData', 'node-port-label', 'end') +
      text(8, 146, 'Write', 'node-port-label', 'start') +
      text(8, 161, 'data', 'node-port-label', 'start');
  } else if (n.type === 'alu') {
    labels +=
      text(38, 86, n.label.slice(0, 8), 'node-name') +
      text(91, 57, 'Zero', 'node-port-label', 'end') +
      text(91, 95, 'Result', 'node-port-label', 'end');
  } else if (['control', 'aluctrl', 'sign', 'shift'].includes(n.type)) {
    const lines = n.label.split(' ');
    lines.forEach((t, i) => (labels += text(w / 2, h / 2 - (lines.length - 1) * 8 + i * 16, t, 'node-name')));
    if (n.type === 'control') labels += text(w / 2, h - 20, 'Op [5:0]', 'node-port-label');
  } else if (n.type === 'constant') {
    labels += text(w / 2, h / 2 + 5, n.value, 'node-name');
  } else if (n.type === 'concat') {
    labels += text(10, -14, 'PC[31:28] + target', 'node-small', 'start');
  } else if (n.type === 'note') {
    const lines = n.label.match(/.{1,24}/gu) || ['Note'];
    lines.slice(0, 4).forEach((t, i) => (labels += text(12, 19 + i * 15, t, 'note-text', 'start')));
  } else if (!['and', 'or'].includes(n.type)) {
    labels += text(w / 2, h / 2 + 5, n.label.slice(0, 16), 'node-name');
  }

  if (state.selected) {
    extra += `<rect x="-9" y="-9" width="${w + 18}" height="${h + 18}" rx="4" class="selection-box"/>`;
  }

  const ps = Circuit.pins(n)
    .map(
      p =>
        `<g><circle class="port-hit" cx="${p.x}" cy="${p.y}" r="9" data-port-node="${E(
          n.id
        )}" data-port="${E(p.id)}"/><circle class="node-port ${p.kind} ${p.dir === 'out' ? 'output' : ''} ${
          pending?.node === n.id && pending?.port === p.id ? 'pending' : ''
        }" cx="${p.x}" cy="${p.y}" r="3.6" data-port-node="${E(n.id)}" data-port="${E(
          p.id
        )}"/><title>${E(p.label)} · ${p.dir === 'out' ? 'Output' : 'Input'} · ${p.bits} bits</title></g>`
    )
    .join('');

  return `<g transform="translate(${n.x},${n.y})" data-node="${E(n.id)}" class="circuit-node ${
    ['control', 'aluctrl', 'and', 'or'].includes(n.type) ? 'control-node' : ''
  } ${state.selected ? 'selected' : ''} ${state.written ? 'written' : ''} ${
    state.invalid ? 'invalid' : ''
  }"><title>${E(n.label)} · ${E(d.description)}</title>${extra}${shape}${labels}${ps}</g>`;
}

/** เรนเดอร์เส้นไฮไลต์หรือจุดควบคุมขณะลากเส้นสายไฟ (Overlay Layer) */
function renderOverlay() {
  let html = '';
  if (selection?.type === 'wire' && mode === 'edit') {
    const w = graph.wires.find(w => w.id === selection.id);
    if (w) {
      const pts = Circuit.orthogonal(graph, w);
      if (pts.length === 2) {
        const p = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        html += `<circle class="bend-handle" cx="${p.x}" cy="${p.y}" r="5" data-bend="mid"><title>ลากเพื่อเพิ่มจุดหักสาย</title></circle>`;
      } else {
        pts
          .slice(1, -1)
          .forEach(
            (p, i) =>
              (html += `<circle class="bend-handle" cx="${p.x}" cy="${p.y}" r="5" data-bend="${i}"><title>ลากจุดหักสาย</title></circle>`)
          );
      }
    }
  }
  if (pending) {
    const a = Circuit.point(graph, pending);
    const b = pending.at || a;
    if (a && b) {
      html += `<path class="pending-wire" d="M${a.x} ${a.y}H${(a.x + b.x) / 2}V${b.y}H${b.x}"/>`;
    }
  }
  $('#overlay').innerHTML = html;
}

/** ฟอร์แมตการแสดงผลค่าสัญญาณไฟ */
function formatValue(value, bits = 32) {
  if (value === null || value === undefined) return '—';
  return bits <= 6 ? value.toString(2).padStart(bits, '0') : (value | 0).toString();
}

/** สร้างชื่อคำอธิบายการเชื่อมต่อสายไฟ */
function connectionName(w) {
  const a = graph.nodes.find(n => n.id === w.from.node);
  const b = graph.nodes.find(n => n.id === w.to.node);
  return `${a?.label || '?'} · ${w.from.port} → ${b?.label || '?'} · ${w.to.port}`;
}

/** คำนวณคำอธิบายเหตุการณ์ของ State ปัจจุบันในแต่ละ Cycle */
function frameExplanation(f) {
  const s = f.state;
  const x = f.inst;
  const b = f.before;
  const c = f.controls;
  const aluNode = graph.nodes.find(n => n.type === 'alu');
  const aluResult = f.portValues[aluNode?.id + '.q'];
  const out = graph.nodes.find(n => n.type === 'latch');
  let title;
  let lead;
  let steps;

  if (s === 0) {
    title = 'อ่านคำสั่ง';
    lead = 'ใช้ memory ร่วมกันเพื่ออ่านคำสั่ง และให้ ALU เตรียม PC ของคำสั่งถัดไป';
    steps = [
      ['เลือก address จาก PC', `PC เดิม ${CPU.hex(b.pc)} · IorD=${c.IorD}`],
      ['อ่านคำสั่งเข้า IR', `MemRead=${c.MemRead} · IRWrite=${c.IRWrite}`],
      [
        'เตรียม PC ถัดไป',
        `ALUSrcA=${c.ALUSrcA} · ALUSrcB=${c.ALUSrcB.toString(2).padStart(2, '0')} · PC ใหม่ ${CPU.hex(
          f.after.pc
        )}`
      ]
    ];
  } else if (x.op === 'j') {
    title = 'กระโดดไปยัง target';
    lead = 'ต่อ target 26 บิตกับ 00 แล้วนำ 4 บิตบนของ PC มาต่อด้านหน้า คำสั่ง j จบที่ state 1';
    steps = [
      ['เลื่อน target ซ้าย 2 บิต', 'IR[25:0] → Shift left 2 → 28 bits'],
      ['ต่อเป็น address 32 บิต', '{PC[31:28], IR[25:0], 00}'],
      ['เขียน PC', `PCSource=${c.PCSource.toString(2).padStart(2, '0')} · PCWrite=${c.PCWrite}`]
    ];
  } else if (s === 1) {
    title =
      x.op === 'beq'
        ? 'เตรียม branch target'
        : ['lw', 'sw'].includes(x.op)
        ? 'คำนวณ memory address'
        : 'คำนวณด้วย ALU';
    lead =
      x.op === 'beq'
        ? 'รอบนี้หาเป้าหมายเก็บไว้ก่อน การเปรียบเทียบ register อยู่ใน state 2'
        : 'ส่ง operand ผ่าน MUX ทั้งสองตัว แล้วเก็บผลไว้ใน ALUOut';
    steps = [
      [
        'เลือก input A',
        `ALUSrcA=${c.ALUSrcA} · A=${
          f.portValues[aluNode?.id + '.q'] === undefined ? '—' : wireInputValue(aluNode, 'a', f)
        }`
      ],
      [
        'เลือก input B',
        `ALUSrcB=${c.ALUSrcB.toString(2).padStart(2, '0')} · B=${wireInputValue(aluNode, 'b', f)}`
      ],
      ['เก็บผลที่ขอบ clock', `ALU result=${aluResult === undefined ? '—' : aluResult | 0} → ALUOut`]
    ];
  } else if (x.op === 'beq') {
    title = f.pcEnable ? 'ค่าเท่ากัน → กระโดด' : 'ค่าไม่เท่ากัน → ไปต่อ';
    lead = 'state 2 เปรียบเทียบ rs กับ rt และใช้ branch target ที่เก็บใน ALUOut จากรอบก่อน';
    steps = [
      ['เปรียบเทียบด้วยการลบ', `Zero=${f.zero ?? '—'} · ALUOp=${c.ALUOp.toString(2).padStart(2, '0')}`],
      ['เปิดการเขียน PC แบบมีเงื่อนไข', `PCWrite OR (PCWriteCond AND Zero) = ${f.pcEnable}`],
      [
        'เลือก target เดิม',
        `ALUOut ก่อนขอบ clock=${b.latches[out?.id] | 0} · PCSource=${c.PCSource
          .toString(2)
          .padStart(2, '0')}`
      ]
    ];
  } else if (x.op === 'lw') {
    title = 'โหลดข้อมูลกลับ register';
    lead = 'ในรูปข้อสอบไม่มี MDR คั่น จึงอ่าน memory และเขียน rt ได้ใน state เดียวกัน';
    steps = [
      ['เลือก address จาก ALUOut', `IorD=${c.IorD} · address=${b.latches[out?.id] | 0}`],
      ['เลือกข้อมูลจาก memory', `MemRead=${c.MemRead} · MemtoReg=${c.MemtoReg}`],
      ['เขียน destination register', `RegDst=${c.RegDst} · RegWrite=${c.RegWrite}`]
    ];
  } else if (x.op === 'sw') {
    title = 'เก็บข้อมูลลง memory';
    lead = 'address มาจาก ALUOut ส่วนข้อมูลที่จะเขียนมาจาก Read data 2 โดยตรง';
    steps = [
      ['เลือก address ที่คำนวณไว้', `ALUOut ก่อนขอบ clock=${b.latches[out?.id] | 0}`],
      ['ส่งข้อมูลจาก rt', 'Read data 2 → Memory write data'],
      ['เปิดการเขียน memory', `MemWrite=${c.MemWrite} · RegWrite=${c.RegWrite}`]
    ];
  } else {
    title = 'เขียนผลกลับ rd';
    lead = 'เลือกผล ALU ที่พักไว้ใน ALUOut แล้วเขียนกลับ register ปลายทาง';
    steps = [
      ['ใช้ผลที่คำนวณในรอบก่อน', `ALUOut ก่อนขอบ clock=${b.latches[out?.id] | 0}`],
      ['เลือก destination rd', `RegDst=${c.RegDst} → IR[15:11]`],
      ['เขียนผลกลับ', `MemtoReg=${c.MemtoReg} · RegWrite=${c.RegWrite}`]
    ];
  }
  return { title, lead, steps };
}

/** ดึงค่าสัญญาณของสายไฟขาเข้าอุปกรณ์ */
function wireInputValue(n, p, f) {
  const w = n && graph.wires.find(w => w.to.node === n.id && w.to.port === p);
  return w ? formatValue(f.values[w.id]) : '—';
}

/** ตรวจสอบว่าโครงสร้างการต่อสายและวงจรเชิงตรรกะถูกแก้ไขหรือไม่ */
function logicModified() {
  const signature = g =>
    JSON.stringify({
      nodes: g.nodes
        .filter(n => n.type !== 'note')
        .map(n => [n.id, n.type, n.bits, n.value, n.jump, n.initial])
        .sort(),
      wires: g.wires
        .map(w => [w.from.node, w.from.port, w.to.node, w.to.port, w.slice?.hi, w.slice?.lo])
        .sort(),
      controls: g.controlOverrides
    });
  return signature(graph) !== signature(Circuit.baseline());
}

/** เรนเดอร์แผงข้อมูลการตรวจสอบด้านขวามือ (Inspector Panel) */
function renderInspector() {
  const pane = $('#inspector');
  const f = frame();

  if (selection) {
    if (selection.type === 'node') {
      const n = graph.nodes.find(n => n.id === selection.id);
      if (n) {
        pane.innerHTML = nodeInspector(n, f);
        return;
      }
    } else {
      const w = graph.wires.find(w => w.id === selection.id);
      if (w) {
        pane.innerHTML = wireInspector(w, f);
        return;
      }
    }
    selection = null;
  }

  if (!f || (simulation.issues.length && mode === 'edit')) {
    pane.innerHTML = `<div class="eyebrow">CIRCUIT CHECK</div><h2>ตรวจวงจรก่อนเดินต่อ</h2><div class="issue-card"><h3>${
      simulation.issues.length
    } จุดที่ต้องแก้</h3><p>การจำลองจะใช้วงจรที่คุณต่อไว้ สายที่ขาดหรือขนาดบิตไม่ตรงต้องแก้ก่อน</p>${simulation.issues
      .slice(0, 20)
      .map((it, i) => `<button class="issue-item" data-issue="${i}">${E(it.message)}</button>`)
      .join(
        ''
      )}</div><div class="button-row"><button id="restore-base-inspector">คืนวงจรต้นแบบ</button><button id="open-code-inspector">ตรวจคำสั่ง</button></div>`;
    return;
  }

  let m = frameExplanation(f);
  if (logicModified()) {
    const an = graph.nodes.find(n => n.type === 'alu');
    m = {
      title: ['อ่านคำสั่ง', 'ประมวลผล', 'จบคำสั่ง'][f.state],
      lead: 'กำลังใช้วงจรที่แก้ไข ค่าด้านล่างคำนวณตามสายและ control ของคุณ',
      steps: [
        ['Operand ที่ ALU ได้รับ', `A=${wireInputValue(an, 'a', f)} · B=${wireInputValue(an, 'b', f)}`],
        ['เปิดการเขียน PC หรือไม่', `PCEnable=${f.pcEnable} · PC หลัง clock=${CPU.hex(f.after.pc)}`],
        ['การเขียนผลในรอบนี้', f.events.join(' · ') || 'ไม่มี architectural write']
      ]
    };
  }

  const signals = Object.entries(f.controls)
    .map(([k, v]) => {
      const ctrl = graph.nodes.find(n => n.type === 'control');
      const used = graph.wires.some(
        w => w.from.node === ctrl?.id && w.from.port === k && f.active.includes(w.id)
      );
      return `<div class="signal ${used ? 'used' : ''}"><span>${k}</span><b>${v
        .toString(2)
        .padStart(Circuit.controls[k], '0')}</b></div>`;
    })
    .join('');

  const changed = f.after.r.map((v, i) => ({ v, i })).filter(x => x.v !== f.before.r[x.i]);

  pane.innerHTML = `<div class="eyebrow">CYCLE INSPECTOR</div><h2>${m.title}</h2><p class="lead">${
    m.lead
  }</p><span class="step-label">STATE ${f.state} · ขั้น ${f.state + 1}/${instructionLength()} <span>→</span> STATE ${
    f.nextState
  }</span><div class="inspector-section"><div class="section-title">เกิดอะไรขึ้นใน cycle นี้</div><div class="steps">${m.steps
    .map(([h, p], i) => `<div class="step"><span>${i + 1}</span><div><b>${E(h)}</b><p>${E(p)}</p></div></div>`)
    .join('')}</div></div><div class="result-card"><small>ผลหลังขอบ clock</small><strong>${
    f.events.map(E).join('<br>') || 'ไม่มีการเขียนค่าใหม่'
  }</strong></div><div class="inspector-section"><div class="section-title">MAIN CONTROL <button id="edit-control">${
    mode === 'edit' ? 'แก้ตาราง ↗' : 'ดูตาราง ↗'
  }</button></div><div class="signal-list">${signals}</div></div><div class="inspector-section"><div class="section-title">STATE SNAPSHOT <span>${
    changed.length
  } register เปลี่ยน</span></div><div class="state-value ${
    f.before.pc !== f.after.pc ? 'changed' : ''
  }"><span>PC</span><span>${CPU.hex(f.after.pc)}</span></div>${graph.nodes
    .filter(n => n.type === 'latch')
    .map(
      n =>
        `<div class="state-value"><span>${E(n.label)}</span><span><i>ก่อน</i>${
          f.before.latches[n.id] | 0
        } <i>→ หลัง</i>${f.after.latches[n.id] | 0}</span></div>`
    )
    .join('')}${changed
    .map(({ v, i }) => `<div class="state-value changed"><span>$${CPU.names[i]}</span><span>${v | 0}</span></div>`)
    .join(
      ''
    )}<details><summary>ดู register และ data memory</summary>${f.after.r
    .map(
      (v, i) =>
        `<div class="state-value ${v !== f.before.r[i] ? 'changed' : ''}"><span>$${CPU.names[i]}</span><span>${
          v | 0
        }</span></div>`
    )
    .join('')}${Object.entries(f.after.m)
    .filter(([ad]) => +ad >= simulation.program.length * 4)
    .map(([ad, v]) => `<div class="state-value"><span>Mem[${ad}]</span><span>${v | 0}</span></div>`)
    .join(
      ''
    )}</details><p class="info-note">ALUOut ในรูป 2 ไม่มี write enable จึงรับผล ALU ทุกขอบ clock; การอ่านในรอบนี้ใช้ค่า <b>ก่อน</b> ขอบ clock</p></div>${
    simulation.halt === 'limit'
      ? '<p class="info-note">หยุดที่ 180 cycles เพื่อให้หน้าเว็บตอบสนองได้ โปรแกรมอาจมี loop</p>'
      : ''
  }${
    simulation.issues.length ? `<p class="dialog-error">${E(simulation.issues[0].message)}</p>` : ''
  }<div class="source-mini"><a href="../sources/FE2019b.pdf#page=4" target="_blank" rel="noopener">รูป 2 ↗</a><a href="../sources/FE2019b.pdf#page=5" target="_blank" rel="noopener">ตาราง 3–4 ↗</a><a href="../sources/COANotes2014.pdf#page=110" target="_blank" rel="noopener">COANotes ↗</a></div>`;
}

/** สร้าง Header สำหรับส่วนการเลือกอุปกรณ์หรือสายไฟ */
function selectionHeader(kind, title) {
  return `<div class="eyebrow">${kind}</div><div class="selection-title"><h2>${E(
    title
  )}</h2><button id="clear-selection" aria-label="ปิดรายละเอียด">×</button></div>`;
}

/** สร้างแผงควบคุมคุณสมบัติเมื่อเลือกตัวอุปกรณ์ (Node Inspector) */
function nodeInspector(n, f) {
  const d = Circuit.definitions[n.type];
  const ps = Circuit.pins(n);
  let html = selectionHeader('COMPONENT', n.label) + `<p class="lead">${E(d.description)}</p>`;

  if (mode === 'edit') {
    html += `<div class="property"><label>ชื่อบนวงจร</label><input data-node-prop="label" value="${E(
      n.label
    )}" maxlength="160"></div><div class="property-row"><div class="property"><label>ตำแหน่ง X</label><input data-node-prop="x" type="number" value="${
      n.x
    }" step="10" min="-10000" max="10000"></div><div class="property"><label>ตำแหน่ง Y</label><input data-node-prop="y" type="number" value="${
      n.y
    }" step="10" min="-10000" max="10000"></div></div>`;
    if (n.type === 'constant') {
      html += `<div class="property-row"><div class="property"><label>ค่าคงที่</label><input data-node-prop="value" type="number" value="${
        n.value
      }" step="1"></div><div class="property"><label>จำนวนบิต</label><select data-node-prop="bits">${[
        1, 2, 4, 5, 6, 16, 26, 28, 32
      ]
        .map(b => `<option value="${b}" ${n.bits === b ? 'selected' : ''}>${b} bits</option>`)
        .join('')}</select></div></div>`;
    }
    if (n.type === 'mux') {
      html += `<div class="property"><label>ความกว้าง data bus</label><select data-node-prop="bits">${[
        1, 2, 5, 6, 16, 32
      ]
        .map(b => `<option value="${b}" ${(n.bits || 32) === b ? 'selected' : ''}>${b} bits</option>`)
        .join('')}</select></div>`;
    }
    if (n.type === 'latch') {
      html += `<div class="property"><label>ค่าเริ่มต้น</label><input data-node-prop="initial" type="number" value="${
        n.initial || 0
      }"></div>`;
    }
  }

  if (n.type === 'control') {
    html += `<button id="edit-control" class="button">${
      mode === 'edit' ? 'แก้ตาราง control' : 'ดูตาราง control'
    } ↗</button>`;
  }

  html += `<div class="inspector-section"><div class="section-title">PINS <span>ค่าก่อนขอบ clock</span></div><div class="port-list">${ps
    .map(p => {
      let value;
      if (p.dir === 'out') {
        value = f?.portValues[n.id + '.' + p.id];
      } else {
        const w = graph.wires.find(w => w.to.node === n.id && w.to.port === p.id);
        value = w ? f?.values[w.id] : undefined;
      }
      return `<div class="port-item"><span class="pin-dot ${p.kind}"></span><span>${
        p.dir === 'out' ? '↗' : '↘'
      } ${E(p.label)}</span><small>${p.bits}b · ${formatValue(value, p.bits)}</small></div>`;
    })
    .join('')}</div></div>`;

  if (mode === 'edit') {
    html += `<div class="button-row"><button id="duplicate-node">ทำสำเนา</button><button id="delete-selection" class="button danger">ลบอุปกรณ์</button></div><p class="info-note">ลากอุปกรณ์บนพื้นที่วงจร สายที่เชื่อมอยู่จะตามขาไปด้วย · ลบแล้วกด Ctrl Z เพื่อคืนได้</p>`;
  } else {
    html += '<div class="button-row"><button data-mode="edit">เปิด Edit เพื่อแก้ไข</button></div>';
  }

  return html;
}

/** ฟังก์ชันผู้ช่วยสร้างรายการตัวเลือกจุดพอร์ตเชื่อมต่อ (Dropdown Options) */
function endpointOptions(dir, current) {
  return graph.nodes
    .flatMap(n =>
      Circuit.pins(n)
        .filter(p => p.dir === dir)
        .map(
          p =>
            `<option value="${E(n.id + '.' + p.id)}" ${
              current.node === n.id && current.port === p.id ? 'selected' : ''
            }>${E(n.label + ' · ' + p.label + ' (' + p.bits + 'b)')}</option>`
        )
    )
    .join('');
}

/** สร้างแผงควบคุมคุณสมบัติเมื่อเลือกสายไฟ (Wire Inspector) */
function wireInspector(w, f) {
  const a = graph.nodes.find(n => n.id === w.from.node);
  const b = graph.nodes.find(n => n.id === w.to.node);
  const p = Circuit.port(graph, w.to);
  const value = f?.values[w.id];

  let html =
    selectionHeader(
      'SIGNAL / ' + (p?.kind === 'control' ? 'CONTROL' : 'DATA'),
      w.label || `${p?.bits || '?'}-bit connection`
    ) +
    `<div class="connection-label">${E(a?.label)} · ${E(Circuit.port(graph, w.from)?.label)}<span class="connection-arrow">↓</span>${E(
      b?.label
    )} · ${E(p?.label)}</div><div class="value-hero">${formatValue(value, p?.bits)}</div><div class="value-caption">${
      value !== undefined && value !== null ? CPU.hex(value) : 'ยังไม่มีค่าที่จำลองได้'
    } · ${f?.active.includes(w.id) ? 'ใช้ในรอบนี้' : 'ไม่ได้ใช้เขียนผลในรอบนี้'}</div>`;

  if (mode === 'edit') {
    html += `<div class="inspector-section"><div class="property"><label>ชื่อสาย</label><input data-wire-prop="label" value="${E(
      w.label
    )}" placeholder="ตั้งชื่อเพื่ออ่านง่าย" maxlength="100"></div><div class="property"><label>จาก output</label><select data-wire-prop="from">${endpointOptions(
      'out',
      w.from
    )}</select></div><div class="property"><label>ไป input</label><select data-wire-prop="to">${endpointOptions(
      'in',
      w.to
    )}</select></div><div class="property"><label>เลือกบางบิต (เช่น 31:28) · ว่าง = ทั้ง bus</label><input data-wire-prop="slice" value="${
      w.slice ? w.slice.hi + ':' + w.slice.lo : ''
    }" placeholder="ทั้งหมด"></div><div class="button-row"><button id="auto-route">จัดสายอัตโนมัติ</button><button id="delete-selection" class="button danger">ลบสาย</button></div><p class="info-note">ลากจุดวงกลมบนสายเพื่อย้ายมุม เปลี่ยนต้นทางหรือปลายทางได้จากช่องด้านบน ข้อมูลจะไหลตามการต่อใหม่จริง</p></div>`;
  } else {
    html += '<div class="button-row"><button data-mode="edit">เปิด Edit เพื่อแก้สาย</button></div>';
  }

  const issues = simulation.issues.filter(i => i.wire === w.id);
  if (issues.length) {
    html += `<div class="dialog-error">${issues.map(i => E(i.message)).join('<br>')}</div>`;
  }

  return html;
}

/** เรนเดอร์แถบแสดงเวลา และสถานะ State ด้านล่าง (Timeline Bar) */
function renderTimeline() {
  const f = frame();
  const count = simulation?.frames.length || 0;
  const s = f?.state || 0;
  const names = [
    'อ่านคำสั่ง',
    f?.inst.op === 'j' ? 'กระโดด' : f?.inst.op === 'beq' ? 'หาเป้าหมาย' : 'คำนวณ',
    f?.inst.op === 'beq' ? 'ตัดสินใจ' : f?.inst.op === 'sw' ? 'เขียน memory' : 'เขียนผลกลับ'
  ];

  $('#cycle-count').innerHTML = `${String(count ? cursor + 1 : 0).padStart(2, '0')} <span>/ ${String(
    count
  ).padStart(2, '0')}</span>`;
  $('#states').innerHTML = currentStates()
    .map(
      ({ state, index }) =>
        `<button class="state-tab ${state === s && f ? 'active' : state < s ? 'past' : ''}" data-state-cycle="${
          index
        }" ${index < 0 ? 'disabled' : ''} ${
          state === s && f ? 'aria-current="step"' : ''
        }><span class="state-dot">${state < s ? '✓' : state}</span><span><small>STATE ${state}${
          index < 0 && f ? ' · SKIP' : ''
        }</small><strong>${index < 0 && f ? 'ไม่ผ่านขั้นนี้' : names[state]}</strong></span></button>`
    )
    .join('');
  $('#prev').disabled = cursor === 0 || !count;
  $('#next').disabled = cursor >= count - 1 || !count;
  $('#play').disabled = !count;
  $('#rewind').disabled = !count;
}

/** คำนวณและอัปเดตมุมมองกล้อง Canvas (Camera Zoom & ViewBox) */
function updateCamera() {
  $('#scene').setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
  $('#zoom-level').textContent = Math.round((fittedWidth / camera.w) * 100) + '%';
}

/** ปรับขนาดกล้องให้ครอบคลุมส่วนประกอบทั้งหมดในวงจร (Fit to Screen) */
function fit() {
  const rect = $('#scene').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ps = graph.nodes
    .flatMap(n => [
      { x: n.x, y: n.y },
      { x: n.x + Circuit.definitions[n.type].w, y: n.y + Circuit.definitions[n.type].h }
    ])
    .concat(graph.wires.flatMap(w => w.points || []));
  if (!ps.length) return;

  const minX = Math.min(...ps.map(p => p.x)) - 85;
  const maxX = Math.max(...ps.map(p => p.x)) + 55;
  const minY = Math.min(...ps.map(p => p.y)) - 45;
  const maxY = Math.max(...ps.map(p => p.y)) + 55;
  let w = maxX - minX;
  let h = maxY - minY;
  let ratio = rect.width / rect.height;

  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;

  camera = { x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h };
  fittedWidth = w;
  updateCamera();
}

/** ซูมเข้า/ออก โดยมีจุดศูนย์กลางตามพิกัดที่กำหนด */
function zoom(factor, at) {
  const nw = Math.min(12000, Math.max(220, camera.w * factor));
  const ratio = nw / camera.w;
  const p = at || { x: camera.x + camera.w / 2, y: camera.y + camera.h / 2 };
  camera = {
    x: p.x - (p.x - camera.x) * ratio,
    y: p.y - (p.y - camera.y) * ratio,
    w: nw,
    h: camera.h * ratio
  };
  updateCamera();
}

/** แปลงพิกัด Screen Pixel เป็นพิกัดโลกใน Canvas SVG */
function world(e) {
  const pt = $('#scene').createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform($('#scene').getScreenCTM().inverse());
}

/** จัดตำแหน่งพิกัดให้อยู่บน Grid Snap (ถ้าเปิดใช้งาน) */
function snapped(p) {
  return $('#snap').checked
    ? { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 }
    : { x: Math.round(p.x), y: Math.round(p.y) };
}

/** ซูมและเลือกตำแหน่งของจุดผิดพลาดชี้ขาด (Focus Diagnostic Issue) */
function focusIssue(index) {
  const issue = simulation.issues[index];
  if (!issue) return;
  mode = 'edit';
  if (issue.wire) selection = { type: 'wire', id: issue.wire };
  else if (issue.node) selection = { type: 'node', id: issue.node };
  else {
    openCode();
    return;
  }
  render();
  const n = graph.nodes.find(n => n.id === issue.node);
  if (n) {
    camera.x = n.x - camera.w / 2;
    camera.y = n.y - camera.h / 2;
    updateCamera();
  }
}

/** สร้างและแสดงผล Dialog Modal */
function dialog(title, subtitle, body, wide = false) {
  stop();
  document.querySelector('dialog')?.remove();
  const el = document.createElement('dialog');
  if (wide) el.style.width = 'min(1080px,94vw)';
  el.innerHTML = `<div class="dialog-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button data-close aria-label="ปิด">×</button></div><div class="dialog-body">${body}</div>`;
  document.body.append(el);
  el.addEventListener('close', () => el.remove());
  el.showModal();
  return el;
}

let syncedCode = null;
let syncedInit = null;

/** ซิงก์โค้ดคำสั่งในหน้าต่างแก้ไขให้ตรงกับตัวแปรหลัก */
function syncCodePane() {
  const p = $('#program');
  const i = $('#initial-values');
  if (syncedCode !== code || syncedInit !== initial) {
    p.value = code;
    i.value = initial;
    syncedCode = code;
    syncedInit = initial;
    $('#code-error').textContent = '';
  }
  updateCodeState();
}

/** อัปเดตสถานะว่ามีการแก้ไขโค้ดที่ยังไม่ได้สั่งรันหรือไม่ */
function updateCodeState() {
  const dirty = $('#program').value !== code || $('#initial-values').value !== initial;
  const s = $('#code-state');
  s.textContent = dirty ? 'แก้ไขแล้ว · ยังไม่ได้รัน' : 'ตรงกับวงจรที่รันอยู่';
  s.classList.toggle('dirty', dirty);
}

/** ประมวลผลและรันโปรแกรม MIPS ใหม่จากช่องป้อนโค้ด */
function runCode() {
  const nextCode = $('#program').value;
  const nextInit = $('#initial-values').value;
  try {
    CPU.parse(nextCode).forEach(NetSim.encode);
    CPU.initial(nextInit);
    code = nextCode;
    initial = nextInit;
    preset = 'custom';
    cursor = 0;
    selection = null;
    $('#code-error').textContent = '';
    save();
    recalculate(false);
    toast('รันโปรแกรมใหม่แล้ว');
  } catch (error) {
    $('#code-error').textContent = error.message;
  }
}

/** เปิดหรือปิดหน้าต่างแผงควบคุมโค้ด */
function setCodeOpen(open) {
  const pane = $('#code-pane');
  const button = $('#open-code');
  pane.hidden = !open;
  $('#side-panel').classList.toggle('code-open', open);
  button.setAttribute('aria-expanded', String(open));
  if (open) {
    pane.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#program').focus({ preventScroll: true });
  } else {
    button.focus({ preventScroll: true });
  }
}

/** เปิดหน้าต่างแก้ไขโค้ด */
function openCode() {
  setCodeOpen(true);
}

$('#program').addEventListener('input', () => {
  $('#code-error').textContent = '';
  updateCodeState();
});
$('#initial-values').addEventListener('input', () => {
  $('#code-error').textContent = '';
  updateCodeState();
});

$('#code-pane').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  }
});

/** รายการอุปกรณ์ทั้งหมดสำหรับเมนูคลังอุปกรณ์ (Library Items) */
const LIBRARY = [
  ['constant', '01', 'ค่าคงที่ / ปรับจำนวนบิต'],
  ['mux', 'MUX', '2 inputs / ปรับ bus width'],
  ['mux4', '4:1', 'MUX สำหรับ 4 inputs'],
  ['alu', 'ALU', 'A / B / Control → Result'],
  ['latch', 'D → Q', 'Register 32 บิต'],
  ['and', '&', 'ประตู AND 1 บิต'],
  ['or', '≥1', 'ประตู OR 1 บิต'],
  ['sign', '16→32', 'Sign extension'],
  ['shift', '<<2', 'เลื่อนข้อมูลซ้าย 2 บิต'],
  ['note', 'Aa', 'เพิ่มข้อความประกอบ'],
  ['pc', 'PC', 'Program counter'],
  ['ir', 'IR', 'Instruction register'],
  ['registers', 'RF', 'Register file'],
  ['memory', 'MEM', 'Shared memory'],
  ['control', 'FSM', 'Main control'],
  ['aluctrl', 'CTL', 'ALU control']
];

$('#library-items').innerHTML = LIBRARY.map(
  ([type, glyph]) =>
    `<button data-add-type="${type}">${componentSymbol(type, glyph)}<b>${E(
      Circuit.definitions[type].name
    )}</b></button>`
).join('');

/** เปิดแผ่นหน้าต่างเลือกเพิ่มอุปกรณ์ (Library Sheet) */
function openLibrary() {
  const s = $('#library-sheet');
  s.inert = false;
  s.classList.add('open');
}

/** ปิดแผ่นหน้าต่างเลือกเพิ่มอุปกรณ์ */
function closeLibrary() {
  const s = $('#library-sheet');
  s.inert = true;
  s.classList.remove('open');
}
