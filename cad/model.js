'use strict';

/** พารามิเตอร์พื้นฐานของวงจร MIPS Datapath  */
const Circuit = (() => {
  /** ทำการคัดลอกข้อมูล Object แบบ Deep Clone */
  const clone = o => JSON.parse(JSON.stringify(o));

  const controls = {
    PCWrite: 1,
    PCWriteCond: 1,
    MemWrite: 1,
    MemRead: 1,
    IRWrite: 1,
    RegWrite: 1,
    PCSource: 2,
    IorD: 1,
    MemtoReg: 1,
    RegDst: 1,
    ALUOp: 2,
    ALUSrcA: 1,
    ALUSrcB: 2
  };

  /** สร้าง Pin Object สำหรับกำหนดพอร์ตเชื่อมต่อของอุปกรณ์ */
  const pin = (id, dir, bits, x, y, label = id, kind = 'data') => ({
    id,
    dir,
    bits,
    x,
    y,
    label,
    kind
  });

  const definitions = {
    pc: {
      name: 'PC',
      w: 34,
      h: 82,
      shape: 'rect',
      description: 'เก็บ address ของคำสั่ง เขียนที่ขอบ clock เมื่อ enable=1',
      pins: [
        pin('d', 'in', 32, 0, 42, 'Next PC'),
        pin('en', 'in', 1, 17, 0, 'PCEnable', 'control'),
        pin('q', 'out', 32, 34, 42, 'PC')
      ]
    },
    memory: {
      name: 'Memory',
      w: 146,
      h: 184,
      shape: 'rect',
      description: 'Memory ร่วมสำหรับคำสั่งและข้อมูล อ่านเมื่อ MemRead=1 เขียนที่ขอบ clock เมื่อ MemWrite=1',
      pins: [
        pin('addr', 'in', 32, 0, 34, 'Address'),
        pin('data', 'in', 32, 0, 150, 'Write data'),
        pin('read', 'in', 1, 45, 0, 'MemRead', 'control'),
        pin('write', 'in', 1, 112, 0, 'MemWrite', 'control'),
        pin('q', 'out', 32, 146, 92, 'MemData')
      ]
    },
    ir: {
      name: 'Instruction register',
      w: 108,
      h: 224,
      shape: 'ir',
      description: 'เก็บ machine code 32 บิต แล้วแยก bit fields; เขียนเมื่อ IRWrite=1',
      pins: [
        pin('d', 'in', 32, 0, 134, 'Instruction'),
        pin('en', 'in', 1, 58, 0, 'IRWrite', 'control'),
        pin('opcode', 'out', 6, 108, 23, '[31:26] opcode'),
        pin('rs', 'out', 5, 108, 64, '[25:21] rs'),
        pin('rt', 'out', 5, 108, 110, '[20:16] rt'),
        pin('imm', 'out', 16, 108, 155, '[15:0] immediate'),
        pin('rd', 'out', 5, 108, 199, '[15:11] rd'),
        pin('funct', 'out', 6, 54, 224, '[5:0] funct'),
        pin('target', 'out', 26, 84, 0, '[25:0] target')
      ]
    },
    registers: {
      name: 'Registers',
      w: 136,
      h: 184,
      shape: 'registers',
      description: '32 × 32 bits: อ่าน rs/rt โดยตรง และเขียน destination เมื่อ RegWrite=1; $zero คงเป็น 0',
      pins: [
        pin('rs', 'in', 5, 0, 22, 'Read register 1'),
        pin('rt', 'in', 5, 0, 68, 'Read register 2'),
        pin('dest', 'in', 5, 0, 114, 'Write register'),
        pin('data', 'in', 32, 0, 160, 'Write data'),
        pin('en', 'in', 1, 64, 0, 'RegWrite', 'control'),
        pin('a', 'out', 32, 136, 57, 'Read data 1'),
        pin('b', 'out', 32, 136, 126, 'Read data 2')
      ]
    },
    mux: {
      name: 'MUX',
      w: 38,
      h: 104,
      shape: 'mux',
      description: 'เลือก input ตามค่า select: 0 หรือ 1; ค่า select เป็น 0 ก็ยังส่งข้อมูลได้',
      pins: [
        pin('i0', 'in', 32, 0, 20, '0'),
        pin('i1', 'in', 32, 0, 84, '1'),
        pin('sel', 'in', 1, 19, 0, 'Select', 'control'),
        pin('q', 'out', 32, 38, 52, 'Output')
      ]
    },
    mux4: {
      name: 'ALUSrcB',
      w: 40,
      h: 112,
      shape: 'mux',
      description: '00: Read data 2 · 01: 4 · 10: signext(imm) · 11: signext(imm) << 2',
      pins: [
        pin('i0', 'in', 32, 0, 20, '0'),
        pin('i1', 'in', 32, 0, 43, '1'),
        pin('i2', 'in', 32, 0, 68, '2'),
        pin('i3', 'in', 32, 0, 92, '3'),
        pin('sel', 'in', 2, 20, 112, 'Select', 'control'),
        pin('q', 'out', 32, 40, 26, 'Output')
      ]
    },
    mux3: {
      name: 'PCSource',
      w: 40,
      h: 100,
      shape: 'mux',
      description: '00: ผล ALU ปัจจุบัน · 01: ALUOut จากรอบก่อน · 10: jump target',
      pins: [
        pin('i0', 'in', 32, 0, 20, '0'),
        pin('i1', 'in', 32, 0, 48, '1'),
        pin('i2', 'in', 32, 0, 78, '2'),
        pin('sel', 'in', 2, 20, 0, 'Select', 'control'),
        pin('q', 'out', 32, 40, 48, 'Output')
      ]
    },
    alu: {
      name: 'ALU',
      w: 98,
      h: 158,
      shape: 'alu',
      description: 'ALU 32 บิตตามรูป 1: control bundle = Ainv, Binv, CarryIn, Operation[1:0]',
      pins: [
        pin('a', 'in', 32, 0, 32, 'A'),
        pin('b', 'in', 32, 0, 126, 'B'),
        pin('op', 'in', 5, 49, 134, 'ALU control', 'control'),
        pin('q', 'out', 32, 98, 86, 'Result'),
        pin('zero', 'out', 1, 98, 58, 'Zero')
      ]
    },
    latch: {
      name: 'ALUOut',
      w: 66,
      h: 50,
      shape: 'rect',
      description: 'Register ไม่มี write enable ในรูป 2 รับผล ALU ทุกขอบ clock; state 2 ใช้ค่าเดิมก่อนขอบ clock',
      pins: [
        pin('d', 'in', 32, 0, 26, 'D'),
        pin('q', 'out', 32, 66, 26, 'Q')
      ]
    },
    sign: {
      name: 'Sign extend',
      w: 60,
      h: 122,
      shape: 'oval',
      description: 'ขยาย immediate 16 บิตเป็น 32 บิต โดยคัดลอก sign bit',
      pins: [
        pin('d', 'in', 16, 0, 61, '16 bits'),
        pin('q', 'out', 32, 60, 61, '32 bits')
      ]
    },
    shift: {
      name: 'Shift left 2',
      w: 48,
      h: 76,
      shape: 'oval',
      description: 'เลื่อนซ้าย 2 บิต เท่ากับคูณ 4 สำหรับ byte address',
      pins: [
        pin('d', 'in', 32, 0, 38, 'Input'),
        pin('q', 'out', 32, 48, 38, 'Output')
      ]
    },
    concat: {
      name: 'Jump address',
      w: 12,
      h: 12,
      shape: 'junction',
      description: 'ต่อ {PC[31:28], shifted target[27:0]} เป็น jump address 32 บิต',
      pins: [
        pin('high', 'in', 4, 6, 12, 'PC[31:28]'),
        pin('low', 'in', 28, 0, 6, 'Target[27:0]'),
        pin('q', 'out', 32, 12, 6, 'Jump address')
      ]
    },
    aluctrl: {
      name: 'ALU control',
      w: 60,
      h: 124,
      shape: 'oval',
      description: 'ALUOp=00 บวก, 01 ลบ, 10 ใช้ funct. Bundle 5 บิตเรียง Ainv/Binv/CarryIn/Operation ตามตาราง 1',
      pins: [
        pin('funct', 'in', 6, 0, 70, 'funct'),
        pin('op', 'in', 2, 30, 124, 'ALUOp', 'control'),
        pin('q', 'out', 5, 60, 60, 'ALU control', 'control')
      ]
    },
    and: {
      name: 'AND',
      w: 44,
      h: 38,
      shape: 'and',
      description: 'ผลเป็น 1 เมื่อ input ทั้งคู่เป็น 1',
      pins: [
        pin('a', 'in', 1, 44, 9, 'A', 'control'),
        pin('b', 'in', 1, 44, 28, 'B', 'control'),
        pin('q', 'out', 1, 0, 19, 'A AND B', 'control')
      ]
    },
    or: {
      name: 'OR',
      w: 52,
      h: 38,
      shape: 'or',
      description: 'PCEnable = PCWrite OR (PCWriteCond AND Zero)',
      pins: [
        pin('a', 'in', 1, 52, 10, 'A', 'control'),
        pin('b', 'in', 1, 52, 31, 'B', 'control'),
        pin('q', 'out', 1, 0, 20, 'A OR B', 'control')
      ]
    },
    constant: {
      name: 'Constant',
      w: 44,
      h: 28,
      shape: 'constant',
      description: 'ค่าคงที่ เปลี่ยนค่าและความกว้างบิตได้ใน Edit',
      pins: [pin('q', 'out', 32, 44, 14, 'Value')]
    },
    control: {
      name: 'Main control',
      w: 84,
      h: 194,
      shape: 'oval',
      description: 'FSM 3 states ตามตาราง 3–4: decode opcode แล้วสร้าง control ทั้ง 13 สัญญาณ',
      pins: [
        pin('opcode', 'in', 6, 42, 194, 'Opcode'),
        ...Object.entries(controls).map(([k, b]) => pin(k, 'out', b, 0, 0, k, 'control'))
      ]
    },
    note: {
      name: 'Note',
      w: 170,
      h: 74,
      shape: 'note',
      description: 'ข้อความประกอบวงจร ไม่มีผลต่อการจำลอง',
      pins: []
    }
  };

  /** สร้าง Node Object ใหม่สำหรับใส่อุปกรณ์ลงในวงจร */
  function node(type, id, x, y, extra = {}) {
    return { id, type, label: definitions[type].name, x, y, ...extra };
  }

  /** ดึงและคำนวณตำแหน่ง Pin ทั้งหมดของ Node ที่ระบุ */
  function pins(n) {
    const ps = clone(definitions[n.type].pins);
    if (n.type === 'mux' && n.bits) {
      ps.forEach(p => {
        if (p.id !== 'sel') p.bits = n.bits;
      });
    }
    if (n.selectBottom) ps.find(p => p.id === 'sel').y = definitions[n.type].h;
    if (n.type === 'shift' && n.jump) {
      ps[0].bits = 26;
      ps[1].bits = 28;
    }
    if (n.type === 'constant') ps[0].bits = n.bits || 32;

    if (n.type === 'control') {
      const loc = {
        PCWriteCond: [12, 29],
        PCWrite: [7, 51],
        IorD: [3, 69],
        MemRead: [1, 94],
        MemWrite: [1, 121],
        MemtoReg: [8, 145],
        IRWrite: [20, 174],
        PCSource: [68, 30],
        ALUOp: [76, 57],
        ALUSrcB: [81, 85],
        ALUSrcA: [81, 111],
        RegWrite: [77, 141],
        RegDst: [66, 167]
      };
      ps.forEach(p => {
        if (loc[p.id]) [p.x, p.y] = loc[p.id];
      });
    }
    return ps;
  }

  /** ค้นหาพอร์ตอ้างอิงของอุปกรณ์ในวงจร */
  function port(g, ref) {
    const n = g.nodes.find(n => n.id === ref.node);
    return n && pins(n).find(p => p.id === ref.port);
  }

  /** คำนวณพิกัดบนหน้าจอของพอร์ตอ้างอิง */
  function point(g, ref) {
    const n = g.nodes.find(n => n.id === ref.node),
      p = port(g, ref);
    return n && p ? { x: n.x + p.x, y: n.y + p.y } : null;
  }

  /** สร้างข้อมูลโครงสร้างวงจร MIPS Datapath ต้นแบบ (Baseline Model) */
  function baseline() {
    const nodes = [
      node('pc', 'pc', 47, 295),
      node('mux', 'iord', 116, 322, { label: 'IorD' }),
      node('memory', 'mem', 169, 338),
      node('ir', 'ir', 383, 296),
      node('mux', 'regdst', 591, 414, { label: 'RegDst', bits: 5 }),
      node('mux', 'memtoreg', 602, 515, { label: 'MemtoReg' }),
      node('registers', 'rf', 666, 338),
      node('mux', 'srca', 941, 326, { label: 'ALUSrcA' }),
      node('mux4', 'srcb', 941, 443),
      node('alu', 'alu', 1017, 344),
      node('latch', 'aluout', 1180, 404),
      node('mux3', 'pcsrc', 1340, 204),
      node('sign', 'sext', 685, 575),
      node('shift', 'bshift', 795, 598),
      node('shift', 'jshift', 1030, 244, { jump: true }),
      node('concat', 'join', 1104, 276),
      node('aluctrl', 'aluctrl', 984, 568),
      node('control', 'ctrl', 574, 41),
      node('and', 'and', 336, 42),
      node('or', 'or', 244, 60),
      node('constant', 'four', 897, 472, { label: '4', value: 4, bits: 32 })
    ];

    const wires = [];
    const w = (id, from, to, points = [], slice) => {
      const ref = s => {
        const [node, port] = s.split('.');
        return { node, port };
      };
      wires.push({
        id,
        from: ref(from),
        to: ref(to),
        points: points.map(([x, y]) => ({ x, y })),
        ...(slice ? { slice } : {}),
        label: ''
      });
    };

    w('pc-memory', 'pc.q', 'iord.i0', [
      [104, 337],
      [104, 342]
    ]);
    w('memory-address', 'iord.q', 'mem.addr');
    w('instruction', 'mem.q', 'ir.d');
    w('load-data', 'mem.q', 'memtoreg.i1', [
      [344, 430],
      [344, 599]
    ]);
    w('pc-a', 'pc.q', 'srca.i0', [
      [94, 337],
      [94, 256],
      [906, 256],
      [906, 346]
    ]);
    w('jump-high', 'pc.q', 'join.high', [
      [94, 337],
      [94, 256],
      [906, 256],
      [906, 322],
      [1110, 322]
    ], { hi: 31, lo: 28 });

    w('opcode', 'ir.opcode', 'ctrl.opcode', [[616, 319]]);
    w('rs', 'ir.rs', 'rf.rs');
    w('rt', 'ir.rt', 'rf.rt');
    w('rt-dest', 'ir.rt', 'regdst.i0', [
      [554, 406],
      [554, 434]
    ]);
    w('rd-dest', 'ir.rd', 'regdst.i1', [
      [548, 495],
      [548, 498]
    ]);
    w('dest', 'regdst.q', 'rf.dest', [
      [642, 466],
      [642, 452]
    ]);
    w('write-data', 'memtoreg.q', 'rf.data', [
      [645, 567],
      [645, 498]
    ]);

    w('read-a', 'rf.a', 'srca.i1', [
      [912, 395],
      [912, 410]
    ]);
    w('read-b', 'rf.b', 'srcb.i0');
    w('store-data', 'rf.b', 'mem.data', [
      [894, 464],
      [894, 746],
      [146, 746],
      [146, 488]
    ]);
    w('four', 'four.q', 'srcb.i1');
    w('imm', 'ir.imm', 'sext.d', [
      [502, 451],
      [502, 636]
    ]);

    w('sign-b', 'sext.q', 'srcb.i2', [
      [775, 636],
      [775, 560],
      [843, 560],
      [843, 511]
    ]);
    w('sign-shift', 'sext.q', 'bshift.d');
    w('branch-offset', 'bshift.q', 'srcb.i3', [
      [913, 636],
      [913, 535]
    ]);
    w('alu-a', 'srca.q', 'alu.a', [
      [999, 378],
      [999, 376]
    ]);
    w('alu-b', 'srcb.q', 'alu.b', [
      [999, 469],
      [999, 470]
    ]);
    w('alu-save', 'alu.q', 'aluout.d');

    w('sequential-pc', 'alu.q', 'pcsrc.i0', [
      [1159, 430],
      [1159, 224]
    ]);
    w('branch-pc', 'aluout.q', 'pcsrc.i1', [
      [1305, 430],
      [1305, 252]
    ]);
    w('address-feedback', 'aluout.q', 'iord.i1', [
      [1260, 430],
      [1260, 765],
      [94, 765],
      [94, 406]
    ]);
    w('result-writeback', 'aluout.q', 'memtoreg.i0', [
      [1260, 430],
      [1260, 765],
      [586, 765],
      [586, 535]
    ]);

    w('jump-field', 'ir.target', 'jshift.d', [[467, 282]]);
    w('jump-low', 'jshift.q', 'join.low');
    w('jump-target', 'join.q', 'pcsrc.i2');
    w('next-pc', 'pcsrc.q', 'pc.d', [
      [1395, 252],
      [1395, 4],
      [10, 4],
      [10, 337]
    ]);
    w('funct', 'ir.funct', 'aluctrl.funct', [
      [437, 728],
      [941, 728],
      [941, 638]
    ]);
    w('zero', 'alu.zero', 'and.a', [
      [1144, 402],
      [1144, 34],
      [399, 34],
      [399, 51]
    ]);

    w('branch-enable', 'and.q', 'or.a', [
      [316, 61],
      [316, 70]
    ]);
    w('pc-enable', 'or.q', 'pc.en', [[64, 80]]);
    w('alu-control', 'aluctrl.q', 'alu.op', [[1066, 628]]);

    const controlWires = [
      ['PCWriteCond', 'and.b', []],
      ['PCWrite', 'or.b', []],
      ['IorD', 'iord.sel', [[135, 110]]],
      ['MemRead', 'mem.read', [[214, 135]]],
      ['MemWrite', 'mem.write', [[281, 162]]],
      [
        'MemtoReg',
        'memtoreg.sel',
        [
          [324, 186],
          [324, 714],
          [621, 714]
        ]
      ],
      ['IRWrite', 'ir.en', [[441, 215]]],
      ['PCSource', 'pcsrc.sel', [[1360, 71]]],
      [
        'ALUOp',
        'aluctrl.op',
        [
          [1128, 98],
          [1128, 710],
          [1014, 710]
        ]
      ],
      [
        'ALUSrcB',
        'srcb.sel',
        [
          [991, 126],
          [991, 568],
          [961, 568]
        ]
      ],
      ['ALUSrcA', 'srca.sel', [[960, 152]]],
      ['RegWrite', 'rf.en', [[730, 182]]],
      [
        'RegDst',
        'regdst.sel',
        [
          [691, 208],
          [691, 329],
          [610, 329]
        ]
      ]
    ];

    nodes.find(n => n.id === 'memtoreg').selectBottom = true;
    nodes.find(n => n.id === 'four').x = 880;

    controlWires.forEach(([name, to, pts]) => w(name, 'ctrl.' + name, to, pts));
    return {
      format: 'datapath-cad',
      version: 1,
      title: 'Figure 2 · Multicycle machine',
      nodes,
      wires,
      controlOverrides: {}
    };
  }

  /** คำนวณจุดกึ่งกลางและเส้นทางวิ่งของสายไฟระหว่างต้นทางและปลายทาง */
  function route(g, w) {
    const a = point(g, w.from),
      b = point(g, w.to);
    if (!a || !b) return [];
    if (w.points?.length) return [a, ...w.points, b];
    if (a.x === b.x || a.y === b.y) return [a, b];
    const mid = (a.x + b.x) / 2;
    return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
  }

  /** แปลงเส้นทางสายไฟให้เป็นเส้นตั้งฉาก (Orthogonal Routing) */
  function orthogonal(g, w) {
    const pts = route(g, w),
      out = [];
    pts.forEach((p, i) => {
      const prev = out.at(-1);
      if (prev && prev.x !== p.x && prev.y !== p.y) {
        out.push(i === pts.length - 1 ? { x: prev.x, y: p.y } : { x: p.x, y: prev.y });
      }
      out.push(p);
    });
    return out.filter((p, i) => !i || p.x !== out[i - 1].x || p.y !== out[i - 1].y);
  }

  /** ตรวจสอบความถูกต้องของวงจร (อุปกรณ์, ขนาดบิต, สายไฟที่ลอยอยู่) */
  function validate(g) {
    const issues = [],
      used = new Set(),
      ids = new Set();
    for (const n of g.nodes) {
      if (ids.has(n.id)) issues.push({ message: 'component ID ซ้ำ: ' + n.id, node: n.id });
      ids.add(n.id);
      if (!definitions[n.type]) issues.push({ message: 'ไม่รู้จักชนิดอุปกรณ์ ' + n.type, node: n.id });
    }

    const edgeIds = new Set();
    for (const w of g.wires) {
      if (edgeIds.has(w.id)) issues.push({ message: 'wire ID ซ้ำ: ' + w.id, wire: w.id });
      edgeIds.add(w.id);
      const a = port(g, w.from),
        b = port(g, w.to);
      if (!a || !b) {
        issues.push({ message: 'สายอ้างถึงขาที่ไม่มีอยู่', wire: w.id });
        continue;
      }
      if (a.dir !== 'out' || b.dir !== 'in') issues.push({ message: 'ต้องต่อจาก output ไป input', wire: w.id });
      const width = w.slice ? w.slice.hi - w.slice.lo + 1 : a.bits;
      if (
        w.slice &&
        (!Number.isInteger(w.slice.hi) ||
          !Number.isInteger(w.slice.lo) ||
          w.slice.lo < 0 ||
          w.slice.hi >= a.bits ||
          w.slice.hi < w.slice.lo)
      ) {
        issues.push({ message: 'ช่วง bit slice ไม่ถูกต้อง', wire: w.id });
      }
      if (width !== b.bits) issues.push({ message: `ขนาดบิตไม่ตรง: ${width} → ${b.bits} bits`, wire: w.id });
      const key = w.to.node + '.' + w.to.port;
      if (used.has(key)) issues.push({ message: 'input มีสายมากกว่า 1 เส้น: ' + key, wire: w.id });
      used.add(key);
    }

    for (const n of g.nodes) {
      if (definitions[n.type]) {
        for (const p of pins(n)) {
          if (p.dir === 'in' && !used.has(n.id + '.' + p.id)) {
            issues.push({ message: `${n.label} · ${p.label} ยังไม่มีสาย`, node: n.id, port: p.id });
          }
        }
      }
    }

    for (const type of ['pc', 'ir', 'registers', 'memory', 'control']) {
      const ns = g.nodes.filter(n => n.type === type);
      if (ns.length !== 1) {
        issues.push({ message: `แบบจำลองต้องมี ${definitions[type].name} 1 ตัว (พบ ${ns.length})` });
      }
    }
    return issues;
  }

  /** แปลงข้อมูล JSON หรือ Object และตรวจสอบความถูกต้องของสกีมาวงจร Datapath CAD v1 */
  function fromJSON(value) {
    const g = typeof value === 'string' ? JSON.parse(value) : clone(value);
    if (
      g?.format !== 'datapath-cad' ||
      g.version !== 1 ||
      !Array.isArray(g.nodes) ||
      !Array.isArray(g.wires) ||
      g.nodes.length > 150 ||
      g.wires.length > 500
    ) {
      throw Error('ไฟล์นี้ไม่ใช่ Datapath CAD v1 หรือมีอุปกรณ์เกินขอบเขต');
    }

    const finite = n => Number.isFinite(n) && Math.abs(n) <= 20000;
    for (const n of g.nodes) {
      if (
        !definitions[n.type] ||
        typeof n.id !== 'string' ||
        typeof n.label !== 'string' ||
        n.label.length > 160 ||
        !finite(n.x) ||
        !finite(n.y)
      ) {
        throw Error('ข้อมูลอุปกรณ์ไม่ถูกต้อง');
      }
      if (
        n.type === 'constant' &&
        (![1, 2, 4, 5, 6, 16, 26, 28, 32].includes(n.bits) || !Number.isInteger(n.value))
      ) {
        throw Error('ค่าคงที่ไม่ถูกต้อง');
      }
    }

    for (const w of g.wires) {
      if (
        typeof w.id !== 'string' ||
        !w.from ||
        !w.to ||
        !Array.isArray(w.points) ||
        w.points.length > 100 ||
        w.points.some(p => !finite(p.x) || !finite(p.y))
      ) {
        throw Error('ข้อมูลสายไม่ถูกต้อง');
      }
    }

    const overrides = g.controlOverrides || {};
    for (const [key, vals] of Object.entries(overrides)) {
      if (!/^[0-2]:(all|0|2|4|35|43)$/.test(key) || !vals || typeof vals !== 'object') {
        throw Error('ตาราง control ไม่ถูกต้อง');
      }
      for (const [k, v] of Object.entries(vals)) {
        if (!(k in controls) || !Number.isInteger(v) || v < 0 || v >= 2 ** controls[k]) {
          throw Error('ค่า control ไม่ถูกต้อง');
        }
      }
    }

    g.controlOverrides = overrides;
    return g;
  }

  return {
    baseline,
    definitions,
    controls,
    clone,
    node,
    pins,
    port,
    point,
    route,
    orthogonal,
    validate,
    fromJSON
  };
})();

if (typeof module !== 'undefined') module.exports = Circuit;
