'use strict';

/**
 * NetSim: ตัวจำลองการทำงานของซีพียู MIPS แบบจำลองสายไฟ (Clocked, Editable-netlist Simulation)
 * - จำลองการส่งสัญญาณจริงตามเส้นสายไฟ (Wires) และโหนดการทำงาน (Nodes/Modules)
 * - อัปเดต State ต่างๆ (PC, IR, Registers, Latches) พร้อมกันที่ขอบสัญญาณนาฬิกา (Clock Edge)
 */
const NetSim = (() => {
  // ดึงโมดูลการทำงานภายนอก (Circuit สำหรับตรวจสอบโครงสร้างวงจร, CPU สำหรับข้อมูลโครงสร้าง ISA ภาษา MIPS)
  const C = typeof Circuit !== 'undefined' ? Circuit : require('./model.js');
  const ISA = typeof CPU !== 'undefined' ? CPU : require('../engine.js');

  /**
   * ฟังก์ชันตัด bit ข้อมูล (Masking) ให้มีความกว้าง b บิตตามที่ต้องการ
   * ช่วยป้องกัน Overflow และแปลงค่าให้เป็น 32-bit Unsigned Integer ด้วย bitwise `>>> 0`
   */
  const mask = (v, b) => b === 32 ? v >>> 0 : (v >>> 0) & (2**b - 1);

  // ตารางแมปชื่อคำสั่ง MIPS กับรหัส Opcode และ Funct
  const functs = { add: 32, sub: 34, and: 36, or: 37, nor: 39, slt: 42 };
  const opcodes = { j: 2, beq: 4, lw: 35, sw: 43 };

  /**
   * แปลงโครงสร้างคำสั่ง Assembly (Object) ให้เป็น Machine Code ขนาด 32 บิต (Integer)
   * @param {Object} x - ออบเจกต์คำสั่ง เช่น { op: 'add', rs: 1, rt: 2, dest: 3 }
   * @returns {number} รหัสคำสั่งภาษาเครื่อง 32 บิต
   */
  function encode(x) {
    // กรณีคำสั่ง R-Type: จัดบิต [op(6) | rs(5) | rt(5) | rd(5) | shamt(5) | funct(6)]
    if (x.op in functs) return ((x.rs << 21) | (x.rt << 16) | (x.dest << 11) | functs[x.op]) >>> 0;
    // กรณีคำสั่ง J-Type: จัดบิต [op(6) | target(26)]
    if (x.op === 'j') return ((2 << 26) | (x.target & 0x3ffffff)) >>> 0;
    // กรณีคำสั่ง I-Type: จัดบิต [op(6) | rs(5) | rt(5) | imm(16)]
    if (x.op in opcodes) return ((opcodes[x.op] << 26) | (x.rs << 21) | (x.rt << 16) | (x.imm & 65535)) >>> 0;
    throw Error('ข้อ 3 รองรับ add, sub, and, or, nor, slt, lw, sw, beq และ j');
  }

  /**
   * ถอดรหัส Machine Code 32 บิต กลับเป็นข้อมูลเชิงโครงสร้างและข้อความ Assembly
   * @param {number} word - คำสั่งภาษาเครื่อง 32 บิต
   * @param {number} pc - ค่า Program Counter ปัจจุบัน (ใช้คำนวณตำแหน่ง Jump target)
   * @returns {Object} ข้อมูลรายละเอียดคำสั่ง (op, rs, rt, rd, imm, funct, text)
   */
  function decode(word, pc = 0) {
    const opcode = word >>> 26,
          rs = (word >>> 21) & 31,
          rt = (word >>> 16) & 31,
          rd = (word >>> 11) & 31,
          funct = word & 63,
          imm = (word << 16) >> 16; // Sign-extension สำหรับค่า Immediate

    let op = opcode === 0 
      ? Object.keys(functs).find(k => functs[k] === funct) 
      : Object.keys(opcodes).find(k => opcodes[k] === opcode);

    // หากไม่พบ Opcode ที่รองรับ ให้คืนค่าเป็น unknown
    if (!op) return { op: 'unknown', opcode, text: '0x' + (word >>> 0).toString(16).padStart(8, '0'), rs, rt, rd, imm, funct };

    const R = i => '$' + ISA.names[i]; // แปลงดัชนี Register เป็นชื่อเช่น $t0, $s0
    let text = opcode === 0 ? `${op} ${R(rd)}, ${R(rs)}, ${R(rt)}`
             : ['lw', 'sw'].includes(op) ? `${op} ${R(rt)}, ${imm}(${R(rs)})`
             : op === 'beq' ? `beq ${R(rs)}, ${R(rt)}, ${imm}`
             : `j ${((pc & 0xf0000000) | ((word & 0x3ffffff) << 2)) >>> 0}`;

    return { op, opcode, rs, rt, rd, imm, funct, text };
  }

  // Helper สร้าง Unique Key สำหรับดึงค่าสัญญาณควบคุมจากตาราง Override
  const rowKey = (s, opcode) => s === 0 ? '0:all' : `${s}:${opcode}`;

  /**
   * คำนวณหาสัญญาณควบคุม (Control Signals) จาก State ของ FSM และ Opcode คำสั่ง
   */
  function control(state, opcode, overrides = {}) {
    const op = opcode === 0 ? 'add' : Object.keys(opcodes).find(k => opcodes[k] === opcode);
    if (state !== 0 && !op) throw Error('Main control ไม่รองรับ opcode ' + opcode.toString(2).padStart(6, '0'));
    const raw = ISA.control(op || 'add', state), c = {};
    for (const [k, v] of Object.entries(raw)) c[k] = parseInt(v, 2);
    return Object.assign(c, overrides[rowKey(state, opcode)] || {});
  }

  /**
   * จำลองวงจร ALU (Arithmetic Logic Unit) ขนาด 32 บิต
   * @param {number} a - ค่า Input A
   * @param {number} b - ค่า Input B
   * @param {number} ctrl - สัญญาณควบคุมการทำงานของ ALU (ALU Control bits)
   * @returns {number} ผลลัพธ์การคำนวณแบบ 32-bit Unsigned Integer
   */
  function alu(a, b, ctrl) {
    const ai = (ctrl >>> 4) & 1,        // กลับบิต Input A (A-invert)
          bi = (ctrl >>> 3) & 1,        // กลับบิต Input B (B-invert)
          carry = (ctrl >>> 2) & 1,     // ค่า Carry in
          operation = ctrl & 3,         // เลือกลอจิกการทำงาน (0:AND, 1:OR, 2:ADD/SUB, 3:SLT)
          A = ai ? ~a : a,
          B = bi ? ~b : b,
          sum = (A + B + carry) | 0;

    let result;
    if (operation === 0) result = A & B;
    else if (operation === 1) result = A | B;
    else if (operation === 2) result = sum;
    else {
      // คำนวณ Operation 3: SLT (Set on Less Than)
      const overflow = ((A ^ sum) & (B ^ sum)) < 0;
      result = Number((sum < 0) !== overflow);
    }
    return result >>> 0;
  }

  /**
   * ฟังก์ชันหลักในการจำลองการทำงานของซีพียูตามวงจรที่กำหนด (Simulation Loop)
   * @param {Object} graph - โครงสร้างเน็ตลิสต์วงจร (Nodes และ Wires)
   * @param {string} code - โค้ดภาษา Assembly MIPS
   * @param {string} initText - ข้อมูลค่าเริ่มต้นของ Memory/Registers
   * @param {number} limit - จำนวน รอบสัญญาณนาฬิกา (Cycles) สูงสุด
   */
  function simulate(graph, code, initText = '', limit = 180) {
    // 1. ตรวจสอบความถูกต้องของวงจร Graph
    const issues = C.validate(graph);
    if (issues.length) return { frames: [], issues, halt: 'invalid' };

    // 2. โหลดโปรแกรมและค่าเริ่มต้น
    let program, initial;
    try {
      program = ISA.parse(code);
      initial = ISA.initial(initText);
      program.forEach(encode); // ตรวจสอบว่าคำสั่งทั้งหมดสามารถ Encode ได้
    } catch (e) {
      return { frames: [], issues: [{ message: e.message }], halt: 'invalid' };
    }

    // สร้าง Map ช่วยค้นหาโหนดและสายไฟอย่างรวดเร็ว
    const byId = new Map(graph.nodes.map(n => [n.id, n])),
          inputs = new Map(graph.wires.map(w => [w.to.node + '.' + w.to.port, w]));

    const one = type => graph.nodes.find(n => n.type === type);
    const pcNode = one('pc'), irNode = one('ir'), rfNode = one('registers'), memNode = one('memory'), ctrlNode = one('control');

    // กำหนด State และ Register เริ่มต้นในวงจร
    let state = 0, pc = 0, ir = 0, irAddress = 0, r = initial.r.map(v => v >>> 0), m = { ...initial.m }, latches = {};
    graph.nodes.filter(n => n.type === 'latch').forEach(n => latches[n.id] = n.initial >>> 0 || 0);

    // ใส่คำสั่ง MIPS ลงใน Memory เริ่มตั้งแต่อพดเดรส 0 (Word aligned)
    program.forEach((x, i) => m[i * 4] = encode(x));
    let frames = [];
    let halt = 'complete';

    // ----------------------------------------------------------------------
    // 3. วนลูปประมวลผลจำลองการทำงานทีละ Clock Cycle
    // ----------------------------------------------------------------------
    for (let cycle = 1; cycle <= limit; cycle++) {
      // เช็คว่า PC หาร 4 ลงตัวหรือไม่ (Word Alignment Check)
      if (pc % 4) {
        issues.push({ message: `PC ${ISA.hex(pc)} ไม่ตรงขอบ word (4 bytes)`, node: pcNode.id });
        halt = 'error';
        break;
      }
      // เช็คว่าทำงานจบโปรแกรมแล้วหรือไม่
      if (state === 0 && (pc >= program.length * 4)) {
        halt = 'complete';
        break;
      }

      const before = { pc, ir, irAddress, r: [...r], m: { ...m }, latches: { ...latches } },
            cache = new Map(),
            stack = new Set();
      let active = new Set(), portValues = {}, wireValues = {}, written = [], events = [];

      const unitValue = (value, deps = []) => ({ value: value >>> 0, deps: new Set(deps) });

      // ดึงค่า Input ของพอร์ตในโหนด ผ่านสายไฟที่เชื่อมอยู่
      function input(n, p) {
        const w = inputs.get(n.id + '.' + p);
        if (!w) throw Error(`${n.label}.${p} ไม่มีสาย`);
        const q = output(w.from.node, w.from.port);
        let value = q.value;
        if (w.slice) value = mask(value >>> w.slice.lo, w.slice.hi - w.slice.lo + 1); // ตัด bit สัญญาณหากมีการ Slice
        const v = unitValue(value, [...q.deps, w.id]);
        wireValues[w.id] = value;
        return v;
      }

      /**
       * คำนวณและคืนค่า Output สัญญาณจากพอร์ตของโหนดอุปกรณ์ (Combinational Logic Evaluation)
       * มีระบบตรวจจับ Combinational Loop เพื่อป้องกัน Infinite Recursion
       */
      function output(id, p) {
        const key = id + '.' + p;
        if (cache.has(key)) return cache.get(key);
        if (stack.has(key)) throw Error(`พบ combinational loop ที่ ${byId.get(id).label}.${p}`);
        stack.add(key);

        const n = byId.get(id), deps = new Set();
        const read = pin => {
          const q = input(n, pin);
          q.deps.forEach(d => deps.add(d));
          return q.value;
        };

        let value = 0;
        // คำนวณค่า Output ตามชนิดของโหนด/โมดูลอุปกรณ์
        switch (n.type) {
          case 'pc': value = pc; break;
          case 'ir': value = ({ opcode: ir >>> 26, rs: ir >>> 21 & 31, rt: ir >>> 16 & 31, rd: ir >>> 11 & 31, imm: ir & 65535, funct: ir & 63, target: ir & 0x3ffffff })[p]; break;
          case 'latch': value = latches[id] || 0; break;
          case 'constant': value = n.value || 0; break;
          case 'registers': value = r[read(p === 'a' ? 'rs' : 'rt') & 31]; break;
          case 'memory': {
            const enabled = read('read');
            if (!enabled) throw Error('Memory output ไม่พร้อม: MemRead=0 แต่มีการใช้ MemData');
            const addr = read('addr');
            if (addr % 4) throw Error(`Memory address ${ISA.hex(addr)} ไม่หาร 4 ลงตัว`);
            value = m[addr] || 0;
            break;
          }
          case 'control': {
            const opcode = state === 0 ? 0 : read('opcode');
            value = control(state, opcode, graph.controlOverrides)[p];
            break;
          }
          case 'mux': case 'mux3': case 'mux4': {
            const sel = read('sel');
            if (!C.pins(n).some(p => p.id === 'i' + sel)) throw Error(`${n.label}: ไม่มี input ${sel}`);
            value = read('i' + sel);
            break;
          }
          case 'sign': value = (read('d') << 16) >> 16; break;                  // Sign Extension (16 บิตเป็น 32 บิต)
          case 'shift': value = read('d') << 2; break;                         // Shift Left 2 บิต
          case 'concat': value = (read('high') << 28) | (read('low') & 0x0fffffff); break; // การรวมบิตสำหรับคำสั่ง Jump
          case 'and': value = read('b') ? read('a') & 1 : 0; break;
          case 'or': value = read('b') ? 1 : read('a') & 1; break;
          case 'aluctrl': {
            const op = read('op');
            if (op === 0) value = 2;
            else if (op === 1) value = 14;
            else if (op === 2) {
              const fn = read('funct');
              const modes = { 32: 2, 34: 14, 36: 0, 37: 1, 39: 24, 42: 15 };
              if (!(fn in modes)) throw Error('ALU control ไม่รองรับ funct ' + fn);
              value = modes[fn];
            } else throw Error('ALUOp=11 ไม่ได้กำหนดในตาราง 1');
            break;
          }
          case 'alu': {
            const result = alu(read('a'), read('b'), read('op'));
            value = p === 'zero' ? Number(result === 0) : result;
            break;
          }
          default: throw Error('อุปกรณ์นี้ไม่มี output สำหรับจำลอง: ' + n.type);
        }

        const bits = C.pins(n).find(q => q.id === p)?.bits || 32;
        const result = unitValue(mask(value, bits), deps);
        cache.set(key, result);
        portValues[key] = result.value;
        stack.delete(key);
        return result;
      }

      // Helper อ่านค่าและติดตามเส้นสายไฟที่แอคทีฟ (Active Wires)
      const use = (n, p, mark = true) => {
        const q = input(n, p);
        if (mark) q.deps.forEach(d => active.add(d));
        return q.value;
      };

      try {
        // อ่านสัญญาณควบคุมการเขียนค่า (Write Enables)
        const pcWrite = use(pcNode, 'en'),
              irWrite = use(irNode, 'en'),
              regWrite = use(rfNode, 'en'),
              memWrite = use(memNode, 'write');

        const nextPC = pcWrite ? use(pcNode, 'd') : pc,
              nextIR = irWrite ? use(irNode, 'd') : ir;

        const nextLatches = {};
        const opcode = ir >>> 26, inst = state === 0 ? decode(nextIR, pc + 4) : decode(ir, irAddress + 4);

        for (const n of graph.nodes.filter(n => n.type === 'latch')) {
          nextLatches[n.id] = use(n, 'd', state === 1 && opcode !== 2);
        }

        let writeReg, writeData, memAddress, memData;

        // ------------------------------------------------------------------
        // อัปเดตค่าเมื่อมีสัญญาณ Write Enable ในแต่ละส่วนอุปกรณ์
        // ------------------------------------------------------------------
        if (regWrite) {
          writeReg = use(rfNode, 'dest');
          writeData = use(rfNode, 'data');
          if (writeReg) {
            written.push(rfNode.id);
            events.push(`$${ISA.names[writeReg]} ← ${writeData | 0}`);
          } else {
            events.push('เขียน $zero ถูกละทิ้ง: คงค่า 0');
          }
        }
        if (memWrite) {
          memAddress = use(memNode, 'addr');
          memData = use(memNode, 'data');
          if (memAddress % 4) throw Error(`Memory address ${ISA.hex(memAddress)} ไม่หาร 4 ลงตัว`);
          written.push(memNode.id);
          events.push(`Mem[${memAddress}] ← ${memData | 0}`);
        }
        if (pcWrite) {
          written.push(pcNode.id);
          events.push(`PC ← ${ISA.hex(nextPC)}`);
        }
        if (irWrite) {
          written.push(irNode.id);
          events.push(`IR ← ${inst.text}`);
        }
        if (state === 1 && opcode !== 2) {
          graph.nodes.filter(n => n.type === 'latch').forEach(n => written.push(n.id));
          events.push('ALUOut ← ' + (nextLatches[graph.nodes.find(n => n.type === 'latch')?.id] | 0));
        }
        if (state === 2 && inst.op === 'beq' && !pcWrite) {
          events.push('ไม่กระโดด: PC คงค่า ' + ISA.hex(pc));
        }

        const ctrlValues = Object.fromEntries(Object.keys(C.controls).map(k => [k, output(ctrlNode.id, k).value]));

        // อ่านค่าสถานะสายไฟคงค้างไว้สำหรับแสดงผล UI
        for (const w of graph.wires) {
          try { input(byId.get(w.to.node), w.to.port); } catch { stack.clear(); wireValues[w.id] = null; }
        }

        // ประมวลผลเปลี่ยนค่า State จริงที่ Clock Edge
        if (regWrite && writeReg) r[writeReg] = writeData >>> 0;
        r[0] = 0; // ล็อกให้ Register $zero (r[0]) เป็น 0 เสมอ
        if (memWrite) m[memAddress] = memData >>> 0;
        if (irWrite) irAddress = pc;

        pc = nextPC >>> 0;
        ir = nextIR >>> 0;
        latches = nextLatches;

        const controllerOpcode = state === 0 ? 0 : input(ctrlNode, 'opcode').value;
        const nextState = state === 0 ? 1 : state === 1 && controllerOpcode !== 2 ? 2 : 0;

        // บันทึก Snapshot ข้อมูลใน Frame ปัจจุบัน
        frames.push({
          cycle,
          state,
          nextState,
          inst,
          before,
          after: { pc, ir, irAddress, r: [...r], m: { ...m }, latches: { ...latches } },
          active: [...active],
          values: wireValues,
          portValues,
          controls: ctrlValues,
          written,
          events,
          pcEnable: pcWrite,
          zero: portValues[graph.nodes.find(n => n.type === 'alu')?.id + '.zero'] ?? null
        });

        state = nextState;
        if (cycle === limit) halt = 'limit';
      } catch (e) {
        issues.push({ message: `Cycle ${cycle} · state ${state}: ${e.message}` });
        halt = 'error';
        break;
      }
    }

    return { frames, issues, halt, initial, program, r, m, pc };
  }

  // ส่งออกอินเทอร์เฟซฟังก์ชันภายนอกสำหรับใช้งาน
  return { simulate, encode, decode, control, rowKey, alu };
})();

// รองรับการ Export โมดูลบน Node.js
if (typeof module !== 'undefined') module.exports = NetSim;
