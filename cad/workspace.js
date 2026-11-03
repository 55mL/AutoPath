'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PRESETS={lw:'lw $s0, 0($s5)',sw:'sw $t0, 4($s5)',add:'add $s0, $t0, $t1',beq:'beq $t0, $t0, target\nadd $s0, $t0, $t1\ntarget: sub $s1, $t0, $t1',j:'j target\nadd $s0, $t0, $t1\ntarget: and $s1, $t0, $t1'};
const DEFAULT_INIT='$s5=256\n$t0=5\n$t1=3\n[256]=42\n[260]=7';
const STORE='datapath-cad-workspace-v1';
let graph=Circuit.baseline(),code=PRESETS.lw,initial=DEFAULT_INIT,preset='lw',mode='learn',tool='select',selection=null,simulation=null,cursor=0,timer=null,pending=null,drag=null,space=false;
let camera={x:-65,y:-55,w:1545,h:880},fittedWidth=1545,undoStack=[],redoStack=[],toastTimer=null,storageEnabled=true;
try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved){graph=Circuit.fromJSON(saved.graph);if(typeof saved.program==='string'&&saved.program.length<=50000)code=saved.program;if(typeof saved.initial==='string'&&saved.initial.length<=20000)initial=saved.initial;preset=saved.preset in PRESETS?saved.preset:'custom'}}catch{storageEnabled=false}
const frame=()=>simulation?.frames[cursor];
const isCustom=()=>{const base=Circuit.baseline();return JSON.stringify(graph.nodes)!==JSON.stringify(base.nodes)||JSON.stringify(graph.wires)!==JSON.stringify(base.wires)||Object.keys(graph.controlOverrides||{}).length>0};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3800)}
function save(){try{localStorage.setItem(STORE,JSON.stringify({graph,program:code,initial,preset}));window.Casebook?.persist();storageEnabled=true;if($('#save-state'))$('#save-state').innerHTML='<i></i>บันทึกในเครื่องแล้ว'}catch{storageEnabled=false;if($('#save-state'))$('#save-state').textContent='ใช้ Export เพื่อเก็บงาน';toast('บันทึกอัตโนมัติไม่ได้ ใช้ไฟล์ → Export JSON เพื่อเก็บงาน')}}
function stop(){clearInterval(timer);timer=null;$('#play').textContent='▶';$('#play').setAttribute('aria-label','เล่นการจำลอง')}
function recalculate(preserve=true){stop();simulation=NetSim.simulate(graph,code,initial);cursor=preserve?Math.min(cursor,Math.max(0,simulation.frames.length-1)):0;render()}
function commit(before,message){undoStack.push(before);if(undoStack.length>80)undoStack.shift();redoStack=[];pending=null;save();recalculate();if(message)toast(message)}
function mutate(fn,message){const before=Circuit.clone(graph);fn();commit(before,message)}
function undo(){if(!undoStack.length)return;redoStack.push(Circuit.clone(graph));graph=undoStack.pop();selection=null;pending=null;save();recalculate();toast('ย้อนกลับแล้ว')}
function redo(){if(!redoStack.length)return;undoStack.push(Circuit.clone(graph));graph=redoStack.pop();selection=null;pending=null;save();recalculate();toast('ทำซ้ำแล้ว')}
function setMode(value){if(value==='edit')window.Casebook?.ensureEditable();stop();mode=value;tool='select';pending=null;selection=null;render();toast(mode==='edit'?'ลากอุปกรณ์เพื่อย้าย · กด W เพื่อต่อสาย · Ctrl Z ย้อนกลับ':'เลือก cycle เพื่อดูค่าที่วิ่งผ่านวงจรนี้')}
function setTool(value){if(value==='wire'&&mode!=='edit'){setMode('edit')}tool=value;pending=null;renderTools();renderOverlay()}
function switchPreset(key){const state=frame()?.state||0;code=PRESETS[key];preset=key;simulation=NetSim.simulate(graph,code,initial);cursor=Math.min(state,key==='j'?1:2,Math.max(0,simulation.frames.length-1));selection=null;stop();save();render()}
function changeCycle(n){stop();cursor=Math.max(0,Math.min(n,(simulation?.frames.length||1)-1));render()}
function instructionLength(){const f=frame();if(!f)return 3;const start=cursor-f.state;for(let i=start;i<Math.min(start+3,simulation.frames.length);i++)if(simulation.frames[i].nextState===0)return i-start+1;return 3}
function currentStates(){const f=frame();if(!f)return [0,1,2].map(s=>({state:s,index:-1}));const start=cursor-f.state,total=instructionLength();return [0,1,2].map(s=>({state:s,index:s<total&&simulation.frames[start+s]?.state===s?start+s:-1}))}
function render(){renderTools();syncCodePane();renderBoard();renderInspector();renderTimeline();$('#current-instruction').textContent=frame()?.inst.text||'ตรวจวงจรก่อนเริ่มจำลอง';$('#presets').innerHTML=Object.keys(PRESETS).map(k=>`<button data-preset="${k}" class="${preset===k?'active':''}">${k}</button>`).join('');const custom=isCustom();$('#design-badge').textContent=custom?'CUSTOM CIRCUIT':'BASE CIRCUIT';$('#design-badge').classList.toggle('custom',custom);$('#counts').textContent=`${graph.nodes.length} components · ${graph.wires.length} wires`;$('#health').textContent=simulation?.issues.length?`${simulation.issues.length} จุดที่ต้องตรวจ`:'● วงจรพร้อมใช้งาน';$('#health').classList.toggle('invalid',!!simulation?.issues.length);$('#mode-status').textContent=mode==='edit'?'Edit · แก้สายแล้วจำลองตามวงจรจริง':'Learn · สายก่อน clock / ผลหลัง clock';$('#undo').disabled=!undoStack.length;$('#redo').disabled=!redoStack.length;$$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode)});$('#add-node').disabled=mode!=='edit';if(mode!=='edit')closeLibrary();document.body.classList.toggle('edit-mode',mode==='edit');window.Casebook?.decorate()}
function renderTools(){$$('button[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$('#scene').dataset.tool=space?'pan':tool;$('#canvas-hint').textContent=pending?'เลือกขาปลายทาง · Esc ยกเลิก':mode==='edit'?tool==='wire'?'ลากจากขา output → input เพื่อต่อสาย':'ลากอุปกรณ์ · คลิกสายแล้วลากจุดมุม · Ctrl Z ย้อนกลับ':'ค่าบนสาย = ก่อน clock · ผลหลัง clock อยู่ด้านขวา'}
function text(x,y,t,cls='',anchor='middle'){return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${E(t)}</text>`}
function pathOf(points){return points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')}
function wireKind(w){return Circuit.port(graph,w.to)?.kind==='control'?'control':'data'}
function renderBoard(){const f=frame(),active=new Set(f?.active||[]),written=new Set(f?.written||[]),badWires=new Set(simulation?.issues.map(i=>i.wire)),badNodes=new Set(simulation?.issues.map(i=>i.node));
 let html=graph.wires.map(w=>{const kind=wireKind(w),points=Circuit.orthogonal(graph,w);if(points.length<2)return '';const selected=selection?.type==='wire'&&selection.id===w.id;return `<g class="wire-group ${kind==='control'?'control-group':''}"><path d="${pathOf(points)}" class="wire-hit" data-wire="${E(w.id)}"/><path d="${pathOf(points)}" class="net-wire ${kind} ${active.has(w.id)?'live':''} ${selected?'selected':''} ${badWires.has(w.id)?'invalid':''}" marker-end="url(#arrow-data)"/><title>${E(w.label||connectionName(w))}${f?.values[w.id]!==null&&f?.values[w.id]!==undefined?' = '+formatValue(f.values[w.id],Circuit.port(graph,w.to)?.bits):''}</title></g>`}).join('');
 html+=graph.nodes.map(n=>nodeSVG(n,{selected:selection?.type==='node'&&selection.id===n.id,written:written.has(n.id),invalid:badNodes.has(n.id)})).join('');
 const ctrl=graph.nodes.find(n=>n.type==='control');if(ctrl)html+=Circuit.pins(ctrl).filter(p=>p.dir==='out').map(p=>{const x=ctrl.x+p.x,y=ctrl.y+p.y,left=p.x<42,v=f?.controls[p.id],live=graph.wires.some(w=>w.from.node===ctrl.id&&w.from.port===p.id&&active.has(w.id));return text(x+(left?-10:10),y-8,`${p.id}${v!==undefined?' = '+v.toString(2).padStart(p.bits,'0'):''}`,'wire-label control-wire-label '+(live?'live':''),left?'end':'start')}).join('');
 if($('#show-values').checked&&f){for(const n of graph.nodes){let val;if(n.type==='pc')val=CPU.hex(f.before.pc);if(n.type==='latch')val='Q = '+(f.before.latches[n.id]|0);if(n.type==='alu')val=f.portValues[n.id+'.zero']!==undefined?'Zero = '+f.portValues[n.id+'.zero']:null;if(val!=null)html+=text(n.x+Circuit.definitions[n.type].w/2,n.y+Circuit.definitions[n.type].h+20,val,'node-value')}}
 $('#drawing').innerHTML=html;$('#scene').classList.toggle('control-hidden',!$('#show-control').checked);renderOverlay();updateCamera();}
function componentShape(n){
 const d=Circuit.definitions[n.type],{w,h}=d;let shape='';
 if(d.shape==='rect'||d.shape==='ir'||d.shape==='registers')shape=`<rect class="node-body" width="${w}" height="${h}" rx="2"/>`;
 if(d.shape==='mux')shape=`<rect class="node-body" width="${w}" height="${h}" rx="${w/2}"/>`;
 if(d.shape==='oval')shape=`<ellipse class="node-body" cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}"/>`;
 if(d.shape==='alu')shape='<path class="node-body" d="M0 0L98 46V112L0 158V105L20 81L0 57Z"/>';
 if(d.shape==='and')shape=`<path class="node-body" d="M44 0H18C-6 0-6 38 18 38H44Z"/>`;
 if(d.shape==='or')shape='<path class="node-body" d="M52 0Q34 19 52 38Q12 41 0 20Q12-2 52 0Z"/>';
 if(d.shape==='junction')shape='<circle class="junction-dot" cx="6" cy="6" r="4"/>';
 if(d.shape==='constant')shape=`<rect class="node-body" width="${w}" height="${h}" rx="5"/>`;
 if(d.shape==='note')shape=`<rect class="note-body" width="${w}" height="${h}" rx="5"/>`;
 return shape;
}
function componentSymbol(type,glyph){
 const n=Circuit.node(type,'preview',0,0),d=Circuit.definitions[type];
 const pins=Circuit.pins(n).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3" class="symbol-pin"/>`).join('');
 const label=['and','or'].includes(type)?'':text(d.w/2,d.h/2+5,glyph,'symbol-label');
 return `<svg class="component-symbol" viewBox="-14 -14 ${d.w+28} ${d.h+28}" aria-hidden="true">${componentShape(n)}${pins}${label}</svg>`;
}
function nodeSVG(n,state){const d=Circuit.definitions[n.type],{w,h}=d;let shape='',labels='',extra='';
 shape=componentShape(n);
 if(d.shape==='mux'){labels+=text(w-11,h/2-12,'M','node-small')+text(w-11,h/2+2,'u','node-small')+text(w-11,h/2+16,'x','node-small');Circuit.pins(n).filter(p=>/^i\d/.test(p.id)).forEach(p=>labels+=text(9,p.y+4,p.label,'node-number'))}
 else if(n.type==='ir'){Circuit.pins(n).filter(p=>['opcode','rs','rt','imm','rd'].includes(p.id)).forEach(p=>{labels+=text(w-10,p.y-7,p.label.split(' ')[0],'node-small','end');labels+=text(w-10,p.y+7,p.id==='imm'?'immediate':p.id,'node-port-label','end')});labels+=text(17,105,'I','node-name')+text(17,122,'R','node-name')}
 else if(n.type==='registers'){[['rs',['Read','register 1']],['rt',['Read','register 2']],['dest',['Write','register']],['data',['Write','data']]].forEach(([id,lines])=>{const p=Circuit.pins(n).find(p=>p.id===id);lines.forEach((t,i)=>labels+=text(8,p.y-4+i*13,t,'node-port-label','start'))});[['a',['Read','data 1']],['b',['Read','data 2']]].forEach(([id,lines])=>{const p=Circuit.pins(n).find(p=>p.id===id);lines.forEach((t,i)=>labels+=text(w-8,p.y-4+i*13,t,'node-port-label','end'))});labels+=text(w/2,100,n.label.slice(0,16),'node-name')}
 else if(n.type==='memory'){labels+=text(w/2,72,n.label.slice(0,16),'node-name')+text(8,39,'Address','node-port-label','start')+text(w-8,97,'MemData','node-port-label','end')+text(8,146,'Write','node-port-label','start')+text(8,161,'data','node-port-label','start')}
 else if(n.type==='alu'){labels+=text(38,86,n.label.slice(0,8),'node-name')+text(91,57,'Zero','node-port-label','end')+text(91,95,'Result','node-port-label','end')}
 else if(['control','aluctrl','sign','shift'].includes(n.type)){const lines=n.label.split(' ');lines.forEach((t,i)=>labels+=text(w/2,h/2-((lines.length-1)*8)+i*16,t,'node-name'));if(n.type==='control')labels+=text(w/2,h-20,'Op [5:0]','node-port-label')}
 else if(n.type==='constant')labels+=text(w/2,h/2+5,n.value,'node-name');
 else if(n.type==='concat')labels+=text(10,-14,'PC[31:28] + target','node-small','start');
 else if(n.type==='note'){const lines=n.label.match(/.{1,24}/gu)||['Note'];lines.slice(0,4).forEach((t,i)=>labels+=text(12,19+i*15,t,'note-text','start'))}
 else if(!['and','or'].includes(n.type))labels+=text(w/2,h/2+5,n.label.slice(0,16),'node-name');
 if(state.selected)extra+=`<rect x="-9" y="-9" width="${w+18}" height="${h+18}" rx="4" class="selection-box"/>`;
 const ps=Circuit.pins(n).map(p=>`<g><circle class="port-hit" cx="${p.x}" cy="${p.y}" r="9" data-port-node="${E(n.id)}" data-port="${E(p.id)}"/><circle class="node-port ${p.kind} ${p.dir==='out'?'output':''} ${pending?.node===n.id&&pending?.port===p.id?'pending':''}" cx="${p.x}" cy="${p.y}" r="3.6" data-port-node="${E(n.id)}" data-port="${E(p.id)}"/><title>${E(p.label)} · ${p.dir==='out'?'Output':'Input'} · ${p.bits} bits</title></g>`).join('');
 return `<g transform="translate(${n.x},${n.y})" data-node="${E(n.id)}" class="circuit-node ${['control','aluctrl','and','or'].includes(n.type)?'control-node':''} ${state.selected?'selected':''} ${state.written?'written':''} ${state.invalid?'invalid':''}"><title>${E(n.label)} · ${E(d.description)}</title>${extra}${shape}${labels}${ps}</g>`;
}
function renderOverlay(){let html='';if(selection?.type==='wire'&&mode==='edit'){const w=graph.wires.find(w=>w.id===selection.id);if(w){const pts=Circuit.orthogonal(graph,w);if(pts.length===2){const p={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};html+=`<circle class="bend-handle" cx="${p.x}" cy="${p.y}" r="5" data-bend="mid"><title>ลากเพื่อเพิ่มจุดหักสาย</title></circle>`}else pts.slice(1,-1).forEach((p,i)=>html+=`<circle class="bend-handle" cx="${p.x}" cy="${p.y}" r="5" data-bend="${i}"><title>ลากจุดหักสาย</title></circle>`)}}
 if(pending){const a=Circuit.point(graph,pending),b=pending.at||a;if(a&&b)html+=`<path class="pending-wire" d="M${a.x} ${a.y}H${(a.x+b.x)/2}V${b.y}H${b.x}"/>`}
 $('#overlay').innerHTML=html;
}
function formatValue(value,bits=32){if(value===null||value===undefined)return '—';return bits<=6?value.toString(2).padStart(bits,'0'):(value|0).toString()}
function connectionName(w){const a=graph.nodes.find(n=>n.id===w.from.node),b=graph.nodes.find(n=>n.id===w.to.node);return `${a?.label||'?'} · ${w.from.port} → ${b?.label||'?'} · ${w.to.port}`}
function frameExplanation(f){const s=f.state,x=f.inst,b=f.before,c=f.controls,aluNode=graph.nodes.find(n=>n.type==='alu'),aluResult=f.portValues[aluNode?.id+'.q'],out=graph.nodes.find(n=>n.type==='latch');let title,lead,steps;
 if(s===0){title='อ่านคำสั่ง';lead='ใช้ memory ร่วมกันเพื่ออ่านคำสั่ง และให้ ALU เตรียม PC ของคำสั่งถัดไป';steps=[['เลือก address จาก PC',`PC เดิม ${CPU.hex(b.pc)} · IorD=${c.IorD}`],['อ่านคำสั่งเข้า IR',`MemRead=${c.MemRead} · IRWrite=${c.IRWrite}`],['เตรียม PC ถัดไป',`ALUSrcA=${c.ALUSrcA} · ALUSrcB=${c.ALUSrcB.toString(2).padStart(2,'0')} · PC ใหม่ ${CPU.hex(f.after.pc)}`]]}
 else if(x.op==='j'){title='กระโดดไปยัง target';lead='ต่อ target 26 บิตกับ 00 แล้วนำ 4 บิตบนของ PC มาต่อด้านหน้า คำสั่ง j จบที่ state 1';steps=[['เลื่อน target ซ้าย 2 บิต','IR[25:0] → Shift left 2 → 28 bits'],['ต่อเป็น address 32 บิต','{PC[31:28], IR[25:0], 00}'],['เขียน PC',`PCSource=${c.PCSource.toString(2).padStart(2,'0')} · PCWrite=${c.PCWrite}`]]}
 else if(s===1){title=x.op==='beq'?'เตรียม branch target':['lw','sw'].includes(x.op)?'คำนวณ memory address':'คำนวณด้วย ALU';lead=x.op==='beq'?'รอบนี้หาเป้าหมายเก็บไว้ก่อน การเปรียบเทียบ register อยู่ใน state 2':'ส่ง operand ผ่าน MUX ทั้งสองตัว แล้วเก็บผลไว้ใน ALUOut';steps=[['เลือก input A',`ALUSrcA=${c.ALUSrcA} · A=${f.portValues[aluNode?.id+'.q']===undefined?'—':wireInputValue(aluNode,'a',f)}`],['เลือก input B',`ALUSrcB=${c.ALUSrcB.toString(2).padStart(2,'0')} · B=${wireInputValue(aluNode,'b',f)}`],['เก็บผลที่ขอบ clock',`ALU result=${aluResult===undefined?'—':aluResult|0} → ALUOut`]]}
 else if(x.op==='beq'){title=f.pcEnable?'ค่าเท่ากัน → กระโดด':'ค่าไม่เท่ากัน → ไปต่อ';lead='state 2 เปรียบเทียบ rs กับ rt และใช้ branch target ที่เก็บใน ALUOut จากรอบก่อน';steps=[['เปรียบเทียบด้วยการลบ',`Zero=${f.zero??'—'} · ALUOp=${c.ALUOp.toString(2).padStart(2,'0')}`],['เปิดการเขียน PC แบบมีเงื่อนไข',`PCWrite OR (PCWriteCond AND Zero) = ${f.pcEnable}`],['เลือก target เดิม',`ALUOut ก่อนขอบ clock=${b.latches[out?.id]|0} · PCSource=${c.PCSource.toString(2).padStart(2,'0')}`]]}
 else if(x.op==='lw'){title='โหลดข้อมูลกลับ register';lead='ในรูปข้อสอบไม่มี MDR คั่น จึงอ่าน memory และเขียน rt ได้ใน state เดียวกัน';steps=[['เลือก address จาก ALUOut',`IorD=${c.IorD} · address=${b.latches[out?.id]|0}`],['เลือกข้อมูลจาก memory',`MemRead=${c.MemRead} · MemtoReg=${c.MemtoReg}`],['เขียน destination register',`RegDst=${c.RegDst} · RegWrite=${c.RegWrite}`]]}
 else if(x.op==='sw'){title='เก็บข้อมูลลง memory';lead='address มาจาก ALUOut ส่วนข้อมูลที่จะเขียนมาจาก Read data 2 โดยตรง';steps=[['เลือก address ที่คำนวณไว้',`ALUOut ก่อนขอบ clock=${b.latches[out?.id]|0}`],['ส่งข้อมูลจาก rt','Read data 2 → Memory write data'],['เปิดการเขียน memory',`MemWrite=${c.MemWrite} · RegWrite=${c.RegWrite}`]]}
 else{title='เขียนผลกลับ rd';lead='เลือกผล ALU ที่พักไว้ใน ALUOut แล้วเขียนกลับ register ปลายทาง';steps=[['ใช้ผลที่คำนวณในรอบก่อน',`ALUOut ก่อนขอบ clock=${b.latches[out?.id]|0}`],['เลือก destination rd',`RegDst=${c.RegDst} → IR[15:11]`],['เขียนผลกลับ',`MemtoReg=${c.MemtoReg} · RegWrite=${c.RegWrite}`]]}
 return{title,lead,steps};
}
function wireInputValue(n,p,f){const w=n&&graph.wires.find(w=>w.to.node===n.id&&w.to.port===p);return w?formatValue(f.values[w.id]):'—'}
function logicModified(){const signature=g=>JSON.stringify({nodes:g.nodes.filter(n=>n.type!=='note').map(n=>[n.id,n.type,n.bits,n.value,n.jump,n.initial]).sort(),wires:g.wires.map(w=>[w.from.node,w.from.port,w.to.node,w.to.port,w.slice?.hi,w.slice?.lo]).sort(),controls:g.controlOverrides});return signature(graph)!==signature(Circuit.baseline())}
function renderInspector(){const pane=$('#inspector'),f=frame();if(selection){if(selection.type==='node'){const n=graph.nodes.find(n=>n.id===selection.id);if(n){pane.innerHTML=nodeInspector(n,f);return}}else{const w=graph.wires.find(w=>w.id===selection.id);if(w){pane.innerHTML=wireInspector(w,f);return}}selection=null}
 if(!f||simulation.issues.length&&mode==='edit'){pane.innerHTML=`<div class="eyebrow">CIRCUIT CHECK</div><h2>ตรวจวงจรก่อนเดินต่อ</h2><div class="issue-card"><h3>${simulation.issues.length} จุดที่ต้องแก้</h3><p>การจำลองจะใช้วงจรที่คุณต่อไว้ สายที่ขาดหรือขนาดบิตไม่ตรงต้องแก้ก่อน</p>${simulation.issues.slice(0,20).map((it,i)=>`<button class="issue-item" data-issue="${i}">${E(it.message)}</button>`).join('')}</div><div class="button-row"><button id="restore-base-inspector">คืนวงจรต้นแบบ</button><button id="open-code-inspector">ตรวจคำสั่ง</button></div>`;return}
 let m=frameExplanation(f);if(logicModified()){const an=graph.nodes.find(n=>n.type==='alu');m={title:['อ่านคำสั่ง','ประมวลผล','จบคำสั่ง'][f.state],lead:'กำลังใช้วงจรที่แก้ไข ค่าด้านล่างคำนวณตามสายและ control ของคุณ',steps:[['Operand ที่ ALU ได้รับ',`A=${wireInputValue(an,'a',f)} · B=${wireInputValue(an,'b',f)}`],['เปิดการเขียน PC หรือไม่',`PCEnable=${f.pcEnable} · PC หลัง clock=${CPU.hex(f.after.pc)}`],['การเขียนผลในรอบนี้',f.events.join(' · ')||'ไม่มี architectural write']]}}
 const signals=Object.entries(f.controls).map(([k,v])=>{const ctrl=graph.nodes.find(n=>n.type==='control');const used=graph.wires.some(w=>w.from.node===ctrl?.id&&w.from.port===k&&f.active.includes(w.id));return `<div class="signal ${used?'used':''}"><span>${k}</span><b>${v.toString(2).padStart(Circuit.controls[k],'0')}</b></div>`}).join('');
 const changed=f.after.r.map((v,i)=>({v,i})).filter(x=>x.v!==f.before.r[x.i]);
 pane.innerHTML=`<div class="eyebrow">CYCLE INSPECTOR</div><h2>${m.title}</h2><p class="lead">${m.lead}</p><span class="step-label">STATE ${f.state} · ขั้น ${f.state+1}/${instructionLength()} <span>→</span> STATE ${f.nextState}</span><div class="inspector-section"><div class="section-title">เกิดอะไรขึ้นใน cycle นี้</div><div class="steps">${m.steps.map(([h,p],i)=>`<div class="step"><span>${i+1}</span><div><b>${E(h)}</b><p>${E(p)}</p></div></div>`).join('')}</div></div><div class="result-card"><small>ผลหลังขอบ clock</small><strong>${f.events.map(E).join('<br>')||'ไม่มีการเขียนค่าใหม่'}</strong></div><div class="inspector-section"><div class="section-title">MAIN CONTROL <button id="edit-control">${mode==='edit'?'แก้ตาราง ↗':'ดูตาราง ↗'}</button></div><div class="signal-list">${signals}</div></div><div class="inspector-section"><div class="section-title">STATE SNAPSHOT <span>${changed.length} register เปลี่ยน</span></div><div class="state-value ${f.before.pc!==f.after.pc?'changed':''}"><span>PC</span><span>${CPU.hex(f.after.pc)}</span></div>${graph.nodes.filter(n=>n.type==='latch').map(n=>`<div class="state-value"><span>${E(n.label)}</span><span><i>ก่อน</i>${f.before.latches[n.id]|0} <i>→ หลัง</i>${f.after.latches[n.id]|0}</span></div>`).join('')}${changed.map(({v,i})=>`<div class="state-value changed"><span>$${CPU.names[i]}</span><span>${v|0}</span></div>`).join('')}<details><summary>ดู register และ data memory</summary>${f.after.r.map((v,i)=>`<div class="state-value ${v!==f.before.r[i]?'changed':''}"><span>$${CPU.names[i]}</span><span>${v|0}</span></div>`).join('')}${Object.entries(f.after.m).filter(([ad])=>+ad>=simulation.program.length*4).map(([ad,v])=>`<div class="state-value"><span>Mem[${ad}]</span><span>${v|0}</span></div>`).join('')}</details><p class="info-note">ALUOut ในรูป 2 ไม่มี write enable จึงรับผล ALU ทุกขอบ clock; การอ่านในรอบนี้ใช้ค่า <b>ก่อน</b> ขอบ clock</p></div>${simulation.halt==='limit'?'<p class="info-note">หยุดที่ 180 cycles เพื่อให้หน้าเว็บตอบสนองได้ โปรแกรมอาจมี loop</p>':''}${simulation.issues.length?`<p class="dialog-error">${E(simulation.issues[0].message)}</p>`:''}<div class="source-mini"><a href="../sources/FE2019b.pdf#page=4" target="_blank" rel="noopener">รูป 2 ↗</a><a href="../sources/FE2019b.pdf#page=5" target="_blank" rel="noopener">ตาราง 3–4 ↗</a><a href="../sources/COANotes2014.pdf#page=110" target="_blank" rel="noopener">COANotes ↗</a></div>`;
}
function selectionHeader(kind,title){return `<div class="eyebrow">${kind}</div><div class="selection-title"><h2>${E(title)}</h2><button id="clear-selection" aria-label="ปิดรายละเอียด">×</button></div>`}
function nodeInspector(n,f){const d=Circuit.definitions[n.type],ps=Circuit.pins(n);let html=selectionHeader('COMPONENT',n.label)+`<p class="lead">${E(d.description)}</p>`;
 if(mode==='edit'){html+=`<div class="property"><label>ชื่อบนวงจร</label><input data-node-prop="label" value="${E(n.label)}" maxlength="160"></div><div class="property-row"><div class="property"><label>ตำแหน่ง X</label><input data-node-prop="x" type="number" value="${n.x}" step="10" min="-10000" max="10000"></div><div class="property"><label>ตำแหน่ง Y</label><input data-node-prop="y" type="number" value="${n.y}" step="10" min="-10000" max="10000"></div></div>`;
 if(n.type==='constant')html+=`<div class="property-row"><div class="property"><label>ค่าคงที่</label><input data-node-prop="value" type="number" value="${n.value}" step="1"></div><div class="property"><label>จำนวนบิต</label><select data-node-prop="bits">${[1,2,4,5,6,16,26,28,32].map(b=>`<option value="${b}" ${n.bits===b?'selected':''}>${b} bits</option>`).join('')}</select></div></div>`;
 if(n.type==='mux')html+=`<div class="property"><label>ความกว้าง data bus</label><select data-node-prop="bits">${[1,2,5,6,16,32].map(b=>`<option value="${b}" ${(n.bits||32)===b?'selected':''}>${b} bits</option>`).join('')}</select></div>`;
 if(n.type==='latch')html+=`<div class="property"><label>ค่าเริ่มต้น</label><input data-node-prop="initial" type="number" value="${n.initial||0}"></div>`;
 }
 if(n.type==='control')html+=`<button id="edit-control" class="button">${mode==='edit'?'แก้ตาราง control':'ดูตาราง control'} ↗</button>`;
 html+=`<div class="inspector-section"><div class="section-title">PINS <span>ค่าก่อนขอบ clock</span></div><div class="port-list">${ps.map(p=>{let value;if(p.dir==='out')value=f?.portValues[n.id+'.'+p.id];else{const w=graph.wires.find(w=>w.to.node===n.id&&w.to.port===p.id);value=w?f?.values[w.id]:undefined}return `<div class="port-item"><span class="pin-dot ${p.kind}"></span><span>${p.dir==='out'?'↗':'↘'} ${E(p.label)}</span><small>${p.bits}b · ${formatValue(value,p.bits)}</small></div>`}).join('')}</div></div>`;
 if(mode==='edit')html+=`<div class="button-row"><button id="duplicate-node">ทำสำเนา</button><button id="delete-selection" class="button danger">ลบอุปกรณ์</button></div><p class="info-note">ลากอุปกรณ์บนพื้นที่วงจร สายที่เชื่อมอยู่จะตามขาไปด้วย · ลบแล้วกด Ctrl Z เพื่อคืนได้</p>`;else html+='<div class="button-row"><button data-mode="edit">เปิด Edit เพื่อแก้ไข</button></div>';return html;
}
function endpointOptions(dir,current){return graph.nodes.flatMap(n=>Circuit.pins(n).filter(p=>p.dir===dir).map(p=>`<option value="${E(n.id+'.'+p.id)}" ${current.node===n.id&&current.port===p.id?'selected':''}>${E(n.label+' · '+p.label+' ('+p.bits+'b)')}</option>`)).join('')}
function wireInspector(w,f){const a=graph.nodes.find(n=>n.id===w.from.node),b=graph.nodes.find(n=>n.id===w.to.node),p=Circuit.port(graph,w.to),value=f?.values[w.id];let html=selectionHeader('SIGNAL / '+(p?.kind==='control'?'CONTROL':'DATA'),w.label||`${p?.bits||'?'}-bit connection`)+`<div class="connection-label">${E(a?.label)} · ${E(Circuit.port(graph,w.from)?.label)}<span class="connection-arrow">↓</span>${E(b?.label)} · ${E(p?.label)}</div><div class="value-hero">${formatValue(value,p?.bits)}</div><div class="value-caption">${value!==undefined&&value!==null?CPU.hex(value):'ยังไม่มีค่าที่จำลองได้'} · ${f?.active.includes(w.id)?'ใช้ในรอบนี้':'ไม่ได้ใช้เขียนผลในรอบนี้'}</div>`;
 if(mode==='edit'){html+=`<div class="inspector-section"><div class="property"><label>ชื่อสาย</label><input data-wire-prop="label" value="${E(w.label)}" placeholder="ตั้งชื่อเพื่ออ่านง่าย" maxlength="100"></div><div class="property"><label>จาก output</label><select data-wire-prop="from">${endpointOptions('out',w.from)}</select></div><div class="property"><label>ไป input</label><select data-wire-prop="to">${endpointOptions('in',w.to)}</select></div><div class="property"><label>เลือกบางบิต (เช่น 31:28) · ว่าง = ทั้ง bus</label><input data-wire-prop="slice" value="${w.slice?w.slice.hi+':'+w.slice.lo:''}" placeholder="ทั้งหมด"></div><div class="button-row"><button id="auto-route">จัดสายอัตโนมัติ</button><button id="delete-selection" class="button danger">ลบสาย</button></div><p class="info-note">ลากจุดวงกลมบนสายเพื่อย้ายมุม เปลี่ยนต้นทางหรือปลายทางได้จากช่องด้านบน ข้อมูลจะไหลตามการต่อใหม่จริง</p></div>`}
 else html+='<div class="button-row"><button data-mode="edit">เปิด Edit เพื่อแก้สาย</button></div>';const issues=simulation.issues.filter(i=>i.wire===w.id);if(issues.length)html+=`<div class="dialog-error">${issues.map(i=>E(i.message)).join('<br>')}</div>`;return html;
}
function renderTimeline(){const f=frame(),count=simulation?.frames.length||0,s=f?.state||0,names=['อ่านคำสั่ง',f?.inst.op==='j'?'กระโดด':f?.inst.op==='beq'?'หาเป้าหมาย':'คำนวณ',f?.inst.op==='beq'?'ตัดสินใจ':f?.inst.op==='sw'?'เขียน memory':'เขียนผลกลับ'];$('#cycle-count').innerHTML=`${String(count?cursor+1:0).padStart(2,'0')} <span>/ ${String(count).padStart(2,'0')}</span>`;$('#states').innerHTML=currentStates().map(({state,index})=>`<button class="state-tab ${state===s&&f?'active':state<s?'past':''}" data-state-cycle="${index}" ${index<0?'disabled':''} ${state===s&&f?'aria-current="step"':''}><span class="state-dot">${state<s?'✓':state}</span><span><small>STATE ${state}${index<0&&f?' · SKIP':''}</small><strong>${index<0&&f?'ไม่ผ่านขั้นนี้':names[state]}</strong></span></button>`).join('');$('#prev').disabled=cursor===0||!count;$('#next').disabled=cursor>=count-1||!count;$('#play').disabled=!count;$('#rewind').disabled=!count;}
function updateCamera(){$('#scene').setAttribute('viewBox',`${camera.x} ${camera.y} ${camera.w} ${camera.h}`);$('#zoom-level').textContent=Math.round(fittedWidth/camera.w*100)+'%'}
function fit(){const rect=$('#scene').getBoundingClientRect();if(!rect.width||!rect.height)return;const ps=graph.nodes.flatMap(n=>[{x:n.x,y:n.y},{x:n.x+Circuit.definitions[n.type].w,y:n.y+Circuit.definitions[n.type].h}]).concat(graph.wires.flatMap(w=>w.points||[]));if(!ps.length)return;const minX=Math.min(...ps.map(p=>p.x))-85,maxX=Math.max(...ps.map(p=>p.x))+55,minY=Math.min(...ps.map(p=>p.y))-45,maxY=Math.max(...ps.map(p=>p.y))+55;let w=maxX-minX,h=maxY-minY,ratio=rect.width/rect.height;if(w/h<ratio)w=h*ratio;else h=w/ratio;camera={x:(minX+maxX-w)/2,y:(minY+maxY-h)/2,w,h};fittedWidth=w;updateCamera()}
function zoom(factor,at){const nw=Math.min(12000,Math.max(220,camera.w*factor)),ratio=nw/camera.w;const p=at||{x:camera.x+camera.w/2,y:camera.y+camera.h/2};camera={x:p.x-(p.x-camera.x)*ratio,y:p.y-(p.y-camera.y)*ratio,w:nw,h:camera.h*ratio};updateCamera()}
function world(e){const pt=$('#scene').createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform($('#scene').getScreenCTM().inverse())}
function snapped(p){return $('#snap').checked?{x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10}:{x:Math.round(p.x),y:Math.round(p.y)}}
function focusIssue(index){const issue=simulation.issues[index];if(!issue)return;mode='edit';if(issue.wire)selection={type:'wire',id:issue.wire};else if(issue.node)selection={type:'node',id:issue.node};else{openCode();return}render();const n=graph.nodes.find(n=>n.id===issue.node);if(n){camera.x=n.x-camera.w/2;camera.y=n.y-camera.h/2;updateCamera()}}
function dialog(title,subtitle,body,wide=false){stop();document.querySelector('dialog')?.remove();const el=document.createElement('dialog');if(wide)el.style.width='min(1080px,94vw)';el.innerHTML=`<div class="dialog-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button data-close aria-label="ปิด">×</button></div><div class="dialog-body">${body}</div>`;document.body.append(el);el.addEventListener('close',()=>el.remove());el.showModal();return el}
let syncedCode=null,syncedInit=null;
function syncCodePane(){const p=$('#program'),i=$('#initial-values');if(syncedCode!==code||syncedInit!==initial){p.value=code;i.value=initial;syncedCode=code;syncedInit=initial;$('#code-error').textContent=''}updateCodeState()}
function updateCodeState(){const dirty=$('#program').value!==code||$('#initial-values').value!==initial,s=$('#code-state');s.textContent=dirty?'แก้ไขแล้ว · ยังไม่ได้รัน':'ตรงกับวงจรที่รันอยู่';s.classList.toggle('dirty',dirty)}
function runCode(){const nextCode=$('#program').value,nextInit=$('#initial-values').value;try{CPU.parse(nextCode).forEach(NetSim.encode);CPU.initial(nextInit);code=nextCode;initial=nextInit;preset='custom';cursor=0;selection=null;$('#code-error').textContent='';save();recalculate(false);toast('รันโปรแกรมใหม่แล้ว')}catch(error){$('#code-error').textContent=error.message}}
function setCodeOpen(open){
 const pane=$('#code-pane'),button=$('#open-code');
 pane.hidden=!open;
 $('#side-panel').classList.toggle('code-open',open);
 button.setAttribute('aria-expanded',String(open));
 if(open){pane.scrollIntoView({block:'nearest',behavior:'smooth'});$('#program').focus({preventScroll:true})}
 else button.focus({preventScroll:true});
}
function openCode(){setCodeOpen(true)}
$('#program').addEventListener('input',()=>{$('#code-error').textContent='';updateCodeState()});$('#initial-values').addEventListener('input',()=>{$('#code-error').textContent='';updateCodeState()});
$('#code-pane').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runCode()}});
const LIBRARY=[['constant','01','ค่าคงที่ / ปรับจำนวนบิต'],['mux','MUX','2 inputs / ปรับ bus width'],['mux4','4:1','MUX สำหรับ 4 inputs'],['alu','ALU','A / B / Control → Result'],['latch','D → Q','Register 32 บิต'],['and','&','ประตู AND 1 บิต'],['or','≥1','ประตู OR 1 บิต'],['sign','16→32','Sign extension'],['shift','<<2','เลื่อนข้อมูลซ้าย 2 บิต'],['note','Aa','เพิ่มข้อความประกอบ'],['pc','PC','Program counter'],['ir','IR','Instruction register'],['registers','RF','Register file'],['memory','MEM','Shared memory'],['control','FSM','Main control'],['aluctrl','CTL','ALU control']];
$('#library-items').innerHTML=LIBRARY.map(([type,glyph])=>`<button data-add-type="${type}">${componentSymbol(type,glyph)}<b>${E(Circuit.definitions[type].name)}</b></button>`).join('');
function openLibrary(){const s=$('#library-sheet');s.inert=false;s.classList.add('open');$('#add-node').classList.add('open')}
function closeLibrary(){const s=$('#library-sheet');if(!s.classList.contains('open'))return;s.classList.remove('open');s.inert=true;$('#add-node').classList.remove('open')}
function toggleLibrary(){$('#library-sheet').classList.contains('open')?closeLibrary():openLibrary()}
const CONTROL_ROWS=[[0,0,'state 0 · ทุกคำสั่ง'],[1,0,'state 1 · R-type'],[1,2,'state 1 · j'],[1,4,'state 1 · beq'],[1,35,'state 1 · lw'],[1,43,'state 1 · sw'],[2,0,'state 2 · R-type'],[2,4,'state 2 · beq'],[2,35,'state 2 · lw'],[2,43,'state 2 · sw']];
function openControl(index){if(index===undefined){const f=frame();index=Math.max(0,CONTROL_ROWS.findIndex(([s,o])=>s===(f?.state||0)&&(s===0||o===f?.inst.opcode)))}dialog('Main control · 3-state FSM','อ้างอิง FE2019b ตาราง 3–4 · เลขบน MUX เป็นฐานสอง',`<label>เลือกแถวในตาราง</label><select id="control-row">${CONTROL_ROWS.map(([s,o,label],i)=>`<option value="${i}" ${i===index?'selected':''}>${label}${s?' · opcode '+o.toString(2).padStart(6,'0'):''}</option>`).join('')}</select><div id="control-fields"></div><div class="note">State machine ตามข้อ 3: 0 → 1 → 2 → 0; j ใช้ 0 → 1 → 0. ค่า control ที่ไม่มีผลต่อคำตอบใส่ 0 ตามโจทย์ การแก้ค่าจะใช้กับทุกคำสั่งใน opcode และ state เดียวกัน</div><div class="dialog-actions">${mode==='edit'?'<button id="reset-control-row" class="button">คืนแถวนี้ตามโจทย์</button><button id="apply-control" class="button primary">ใช้ค่า control นี้</button>':'<button id="enable-control-edit" class="button primary">เข้า Edit เพื่อแก้ค่า</button>'}</div>`);renderControlFields(index)}
function renderControlFields(index){const [s,o]=CONTROL_ROWS[index],values=NetSim.control(s,o,graph.controlOverrides);$('#control-fields').innerHTML=`<div class="control-editor">${Object.entries(Circuit.controls).map(([name,bits])=>`<div class="control-field"><label for="ctrl-${name}">${name}</label><select id="ctrl-${name}" data-control-field="${name}" ${mode!=='edit'?'disabled':''}>${Array.from({length:2**bits},(_,v)=>`<option value="${v}" ${v===values[name]?'selected':''}>${v.toString(2).padStart(bits,'0')}</option>`).join('')}</select></div>`).join('')}</div>`}
function openSource(){dialog('วงจรต้นฉบับ · ข้อ 3','FE2019b หน้า 4–5 · ตัวทดลองนี้เป็นการจำลองเพื่อการเรียน ไม่ใช่เฉลยทางการ',`<div class="button-row"><a class="button" href="../sources/FE2019b.pdf#page=4" target="_blank" rel="noopener">เปิดข้อสอบ PDF ↗</a><a class="button" href="../sources/COANotes2014.pdf#page=110" target="_blank" rel="noopener">อ่าน COANotes ↗</a></div><div class="paper-grid"><img src="../assets/exam-4.png" alt="FE2019b Figure 2 Multicycle machine และโจทย์ข้อ 3"><img src="../assets/exam-5.png" alt="FE2019b ตาราง 3 และ 4 ของข้อ 3"></div>`,true)}
function openHelp(){dialog('พื้นที่เรียนรู้ที่แก้ไขได้','วงจรต้นแบบของข้อ 3 พร้อมเครื่องมือออกแบบการต่อสาย',`<div class="help-grid"><div><h3>01 · เรียนทีละ state</h3><p>เลือกคำสั่ง แล้วกด state ด้านล่าง หรือเล่นทีละ clock สลับคำสั่งแล้ว state ที่เลือกจะคงเดิม คลิกสายเพื่อดูข้อมูลก่อนขอบ clock</p></div><div><h3>02 · แก้วงจรใน Edit</h3><p>ลากอุปกรณ์เพื่อย้าย กด W แล้วลากจากขา output ไป input คลิกสายแล้วลากจุดมุม เปลี่ยนต้นทาง/ปลายทางได้ในแผงขวา</p></div><div><h3>03 · ทดลองผลจริง</h3><p>สายและ control ที่แก้จะมีผลต่อการจำลอง เช่น เปลี่ยนค่าคงที่ 4 เป็น 8 แล้วดู PC ระบบตรวจสายขาด ขนาดบิต และ input ที่มีสายซ้อน</p></div><div><h3>04 · เก็บงานของคุณ</h3><p>บันทึกอัตโนมัติใน browser เครื่องนี้ ใช้ Export JSON เพื่อเก็บสำรอง/ส่งงานให้เพื่อน แล้ว Import เพื่อแก้ต่อได้ หรือส่งออกภาพ SVG</p></div></div><div class="keys">${[['V','เลือก / ย้ายอุปกรณ์'],['W','ต่อสาย'],['H / Space','เลื่อนพื้นที่'],['Wheel','ซูมตำแหน่งเมาส์'],['F','พอดีจอ'],['Delete','ลบสิ่งที่เลือก'],['Ctrl Z / Ctrl Shift Z','Undo / Redo'],['Ctrl S','Export JSON'],['← / →','cycle ก่อนหน้า / ถัดไป'],['Esc','ยกเลิกการต่อสาย']].map(([k,t])=>`<div><kbd>${k}</kbd>${t}</div>`).join('')}</div><div class="note">จำลองข้อมูลดิจิทัล 32 บิตที่ขอบ clock ไม่ใช่ SPICE: ไม่มี delay ทางไฟฟ้า, cache, exception หรือ signed-overflow trap; arithmetic เก็บผลต่ำ 32 บิต. FSM ยึด 3 states ของข้อ 3. ALUOut ไม่มี enable จึงรับผลทุก clock และวงจรอ่านค่าเดิมก่อนเขียนพร้อมกัน</div>`)}
function openTrace(){dialog('เส้นทางทั้งโปรแกรม',`${simulation.frames.length} cycles · คลิกแถวเพื่อกระโดดไปดูรอบนั้น`, `<div class="table-wrap"><table><thead><tr><th>Cycle</th><th>Instruction</th><th>State</th><th>ผลหลัง clock</th></tr></thead><tbody>${simulation.frames.map((f,i)=>`<tr><td><button data-trace-cycle="${i}">${f.cycle}</button></td><td><code>${E(f.inst.text)}</code></td><td>${f.state}</td><td>${f.events.map(E).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`,true)}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function exportJSON(){download('datapath-circuit.json',JSON.stringify({...graph,program:code,initial,preset},null,2),'application/json');toast('ส่งออก JSON แล้ว นำกลับมาแก้ต่อด้วย Import ได้')}
function exportSVG(){const svg=$('#scene').cloneNode(true);svg.removeAttribute('tabindex');svg.classList.remove('control-hidden');svg.querySelector('#board-grid')?.remove();svg.querySelector('#overlay')?.remove();svg.querySelectorAll('.wire-hit,.node-port,.port-hit,.selection-box,.case-halo').forEach(n=>n.remove());svg.querySelectorAll('.net-wire').forEach(p=>{p.setAttribute('fill','none');p.setAttribute('stroke',p.classList.contains('control')?'#9dbb1c':p.classList.contains('live')?'#141414':'#b9bbb0');p.setAttribute('stroke-width',p.classList.contains('live')?'2.5':'1.5')});svg.querySelectorAll('.node-body').forEach(n=>{n.setAttribute('fill','#fff');n.setAttribute('stroke','#8294b0');n.setAttribute('stroke-width','1.4')});svg.querySelectorAll('.note-body').forEach(n=>{n.setAttribute('fill','#fffcef');n.setAttribute('stroke','#ddd0af')});svg.querySelectorAll('text').forEach(n=>{n.setAttribute('font-family','Arial, sans-serif');n.setAttribute('font-size',n.classList.contains('node-name')?'14':'11');n.setAttribute('fill',n.classList.contains('wire-label')?'#7a8f1e':'#4a4c44')});const b=graphBounds();svg.setAttribute('viewBox',`${b.x} ${b.y} ${b.w} ${b.h}`);svg.setAttribute('width',b.w);svg.setAttribute('height',b.h);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');download('datapath-circuit.svg',new XMLSerializer().serializeToString(svg),'image/svg+xml');toast('ส่งออกภาพ SVG แล้ว')}
function graphBounds(){const pts=graph.nodes.flatMap(n=>[{x:n.x,y:n.y},{x:n.x+Circuit.definitions[n.type].w,y:n.y+Circuit.definitions[n.type].h+25}]).concat(graph.wires.flatMap(w=>w.points));if(!pts.length)return{x:0,y:0,w:1420,h:825};const x=Math.min(...pts.map(p=>p.x))-35,y=Math.min(...pts.map(p=>p.y))-35;return{x,y,w:Math.max(...pts.map(p=>p.x))-x+35,h:Math.max(...pts.map(p=>p.y))-y+35}}
function showFileMenu(){const old=$('.menu-popover');if(old){old.remove();return}const menu=document.createElement('div');menu.className='menu-popover';menu.innerHTML='<button id="export-json">Export JSON <span>Ctrl S</span></button><button id="import-json">Import JSON <span>Ctrl O</span></button><button id="export-svg">Export SVG <span>ภาพวงจร</span></button><hr><button id="restore-base">คืนวงจรต้นแบบ <span>Undo ได้</span></button>';document.body.append(menu)}
function newId(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6)}
function addNode(type){const id=newId(type),p=snapped({x:camera.x+camera.w/2,y:camera.y+camera.h/2});mutate(()=>{graph.nodes.push(Circuit.node(type,id,p.x,p.y,{...(type==='constant'?{value:0,bits:32}:{}),...(type==='note'?{label:'เขียนโน้ตของคุณ'}:{})}));selection={type:'node',id}},'เพิ่มอุปกรณ์แล้ว ต่อขาให้ครบเพื่อจำลอง');closeLibrary()}
function deleteSelection(){if(mode!=='edit'||!selection)return;const prev=selection;mutate(()=>{if(prev.type==='node'){graph.nodes=graph.nodes.filter(n=>n.id!==prev.id);graph.wires=graph.wires.filter(w=>w.from.node!==prev.id&&w.to.node!==prev.id)}else graph.wires=graph.wires.filter(w=>w.id!==prev.id);selection=null},'ลบแล้ว · กด Ctrl Z เพื่อคืน')}
function connect(a,b){const pa=Circuit.port(graph,a),pb=Circuit.port(graph,b);if(!pa||!pb)return;let from=a,to=b;if(pa.dir==='in'&&pb.dir==='out')[from,to]=[b,a];const out=Circuit.port(graph,from),input=Circuit.port(graph,to);if(out.dir!=='out'||input.dir!=='in'){toast('ต่อจากขา output ไปขา input เท่านั้น');return}if(out.bits!==input.bits){toast(`ขนาดบิตไม่ตรง: ${out.bits} → ${input.bits} bits · ใช้ช่อง bit slice ในรายละเอียดสาย`);return}const id=newId('wire');mutate(()=>{graph.wires=graph.wires.filter(w=>w.to.node!==to.node||w.to.port!==to.port);graph.wires.push({id,from:{node:from.node,port:from.port},to:{node:to.node,port:to.port},points:[],label:''});selection={type:'wire',id}},'ต่อสายแล้ว ผลการจำลองอัปเดตตามวงจร');pending=null;renderTools();renderOverlay()}
function handlePort(ref){if(mode!=='edit')return;if(pending){if(pending.node===ref.node&&pending.port===ref.port){pending=null;render();return}connect(pending,ref)}else{pending={...ref};selection=null;render();toast('เลือกขาปลายทาง หรือกด Esc ยกเลิก')}}
$('#scene').addEventListener('pointerdown',e=>{closeLibrary();if(e.button!==0&&e.button!==1)return;const target=e.target,p=world(e);if(tool==='pan'||space||e.button===1){drag={kind:'pan',start:{x:e.clientX,y:e.clientY},camera:{...camera}};$('#scene').setPointerCapture(e.pointerId);e.preventDefault();return}
 const portEl=target.closest('[data-port-node]');if(mode==='edit'&&portEl){const ref={node:portEl.dataset.portNode,port:portEl.dataset.port};if(pending){handlePort(ref);return}pending={...ref,at:{x:p.x,y:p.y}};drag={kind:'wire',ref,start:p};$('#scene').setPointerCapture(e.pointerId);renderTools();renderOverlay();e.preventDefault();return}
 const bend=target.closest('[data-bend]');if(mode==='edit'&&bend&&selection?.type==='wire'){const w=graph.wires.find(w=>w.id===selection.id),before=Circuit.clone(graph),pts=Circuit.orthogonal(graph,w);let index;if(bend.dataset.bend==='mid'){w.points=[{x:(pts[0].x+pts.at(-1).x)/2,y:(pts[0].y+pts.at(-1).y)/2}];index=0}else{w.points=pts.slice(1,-1);index=+bend.dataset.bend}drag={kind:'bend',wire:w.id,index,before,moved:false,start:p};$('#scene').setPointerCapture(e.pointerId);e.preventDefault();return}
 const node=target.closest('[data-node]'),wire=target.closest('[data-wire]');if(node){selection={type:'node',id:node.dataset.node};const n=graph.nodes.find(n=>n.id===selection.id);if(mode==='edit'&&tool==='select'){drag={kind:'node',id:n.id,start:p,origin:{x:n.x,y:n.y},before:Circuit.clone(graph),moved:false};$('#scene').setPointerCapture(e.pointerId)}renderBoard();renderInspector();return}
 if(wire){selection={type:'wire',id:wire.dataset.wire};renderBoard();renderInspector();return}
 if(!pending){selection=null;renderBoard();renderInspector()}else{pending.at=p;renderOverlay()}
});
$('#scene').addEventListener('pointermove',e=>{const p=world(e);if(drag?.kind==='pan'){const rect=$('#scene').getBoundingClientRect();camera.x=drag.camera.x-(e.clientX-drag.start.x)*drag.camera.w/rect.width;camera.y=drag.camera.y-(e.clientY-drag.start.y)*drag.camera.h/rect.height;updateCamera();return}
 if(drag?.kind==='node'){const n=graph.nodes.find(n=>n.id===drag.id),q=snapped({x:drag.origin.x+p.x-drag.start.x,y:drag.origin.y+p.y-drag.start.y});if(Math.abs(p.x-drag.start.x)+Math.abs(p.y-drag.start.y)>3)drag.moved=true;n.x=q.x;n.y=q.y;renderBoard();return}
 if(drag?.kind==='bend'){const w=graph.wires.find(w=>w.id===drag.wire);w.points[drag.index]=snapped(p);drag.moved=true;renderBoard();return}
 if(pending){pending.at={x:p.x,y:p.y};renderOverlay()}
});
$('#scene').addEventListener('pointerup',e=>{const done=drag;drag=null;if($('#scene').hasPointerCapture(e.pointerId))$('#scene').releasePointerCapture(e.pointerId);if(!done)return;if(done.kind==='wire'){const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-port-node]');if(el&&(el.dataset.portNode!==done.ref.node||el.dataset.port!==done.ref.port)){connect(done.ref,{node:el.dataset.portNode,port:el.dataset.port})}else{renderTools();renderOverlay()}return}if(['node','bend'].includes(done.kind)&&done.moved)commit(done.before,'');else if(done.kind==='bend'){graph=done.before;render()}});
$('#scene').addEventListener('pointercancel',()=>{if(drag?.before){graph=drag.before;render()}drag=null;pending=null;renderOverlay()});
$('#scene').addEventListener('wheel',e=>{if(e.ctrlKey||mode==='edit'||e.deltaY){e.preventDefault();zoom(Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.0025),world(e))}},{passive:false});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b){if(!e.target.closest('.menu-popover'))$('.menu-popover')?.remove();return}if(b.disabled)return;if(b.hasAttribute('data-sheet-close')){closeLibrary();return}if(b.hasAttribute('data-close')){b.closest('dialog').close();return}if(b.dataset.mode){setMode(b.dataset.mode);return}if(b.dataset.tool){setTool(b.dataset.tool);return}if(b.dataset.preset){switchPreset(b.dataset.preset);return}if(b.dataset.stateCycle!==undefined){changeCycle(+b.dataset.stateCycle);return}if(b.dataset.issue!==undefined){focusIssue(+b.dataset.issue);return}if(b.dataset.addType){addNode(b.dataset.addType);return}if(b.dataset.traceCycle!==undefined){$('dialog').close();changeCycle(+b.dataset.traceCycle);return}
 const id=b.id;if(id!=='file-menu')$('.menu-popover')?.remove();switch(id){
  case'file-menu':showFileMenu();break;case'export-json':exportJSON();break;case'export-svg':exportSVG();break;case'import-json':$('#import-input').click();break;
  case'open-code':setCodeOpen($('#code-pane').hidden);break;case'open-code-inspector':openCode();break;case'source':openSource();break;case'help':openHelp();break;case'add-node':toggleLibrary();break;
  case'undo':undo();break;case'redo':redo();break;case'zoom-in':zoom(.8);break;case'zoom-out':zoom(1.25);break;case'fit':fit();break;
  case'clear-selection':selection=null;render();break;case'delete-selection':deleteSelection();break;
  case'duplicate-node':{const n=graph.nodes.find(n=>n.id===selection?.id);if(n)mutate(()=>{const copy=Circuit.clone(n);copy.id=newId(n.type);copy.x+=80;copy.y+=60;graph.nodes.push(copy);selection={type:'node',id:copy.id}},'ทำสำเนาอุปกรณ์แล้ว');break}
  case'auto-route':mutate(()=>{graph.wires.find(w=>w.id===selection?.id).points=[]},'จัดเส้นทางอัตโนมัติแล้ว');break;
  case'restore-base-inspector':case'restore-base':mutate(()=>{graph=Circuit.baseline();selection=null},'คืนวงจรตามข้อ 3 แล้ว · Undo เพื่อกลับไปงานเดิมได้');fit();break;
  case'prev':changeCycle(cursor-1);break;case'next':changeCycle(cursor+1);break;case'rewind':changeCycle(0);break;
  case'play':if(timer)stop();else{if(cursor===simulation.frames.length-1)cursor=0;$('#play').textContent='Ⅱ';$('#play').setAttribute('aria-label','หยุดการจำลอง');render();timer=setInterval(()=>{if(cursor>=simulation.frames.length-1){stop();return}cursor++;render()},1600)}break;
  case'trace':openTrace();break;case'edit-control':openControl();break;
  case'enable-control-edit':{const index=+$('#control-row').value;$('dialog').close();setMode('edit');openControl(index);break}
  case'apply-control':{const[s,o]=CONTROL_ROWS[+$('#control-row').value],key=NetSim.rowKey(s,o),values=Object.fromEntries($$('[data-control-field]').map(el=>[el.dataset.controlField,+el.value]));$('dialog').close();mutate(()=>{const defaults=NetSim.control(s,o);if(JSON.stringify(defaults)===JSON.stringify(values))delete graph.controlOverrides[key];else graph.controlOverrides[key]=values},'ใช้ค่า control ใหม่แล้ว');break}
  case'reset-control-row':{const index=+$('#control-row').value,[s,o]=CONTROL_ROWS[index];mutate(()=>delete graph.controlOverrides[NetSim.rowKey(s,o)],'คืนค่า control แถวนี้แล้ว');renderControlFields(index);break}
  case'load-sequence':$('#program').value='lw $s0, 0($s5)\nadd $s1, $s0, $t0\nsw $s1, 4($s5)';updateCodeState();break;
  case'load-untaken':$('#program').value='beq $t0, $t1, target\nadd $s0, $t0, $t1\ntarget: sub $s1, $t0, $t1';updateCodeState();break;
  case'run-code':runCode();break;
 }});
document.addEventListener('change',async e=>{const el=e.target;if(['show-control','show-values'].includes(el.id)){renderBoard();return}if(el.id==='control-row'){renderControlFields(+el.value);return}
 if(el.dataset.nodeProp&&mode==='edit'){const n=graph.nodes.find(n=>n.id===selection?.id);if(!n)return;const key=el.dataset.nodeProp;let value=key==='label'?el.value:Number(el.value);if(key!=='label'&&(!Number.isFinite(value)||!Number.isInteger(value)||['x','y'].includes(key)&&Math.abs(value)>10000)){toast('ใส่ค่าจำนวนเต็มในขอบเขตที่กำหนด');renderInspector();return}mutate(()=>n[key]=value,'');return}
 if(el.dataset.wireProp&&mode==='edit'){const w=graph.wires.find(w=>w.id===selection?.id);if(!w)return;const key=el.dataset.wireProp;if(key==='slice'){const v=el.value.trim();if(v&&!/^\d+:\d+$/.test(v)){toast('ระบุช่วงบิตเป็น hi:lo เช่น 31:28');renderInspector();return}mutate(()=>{if(v){const [hi,lo]=v.split(':').map(Number);w.slice={hi,lo}}else delete w.slice},'')}else if(key==='from'||key==='to'){const dot=el.value.lastIndexOf('.'),ref={node:el.value.slice(0,dot),port:el.value.slice(dot+1)};mutate(()=>{if(key==='to')graph.wires=graph.wires.filter(z=>z.id===w.id||z.to.node!==ref.node||z.to.port!==ref.port);w[key]=ref;w.points=[]},'เปลี่ยนปลายสายแล้ว')}else mutate(()=>w.label=el.value,'');return}
 if(el.id==='import-input'){const file=el.files[0];if(!file)return;try{if(file.size>2_000_000)throw Error('ไฟล์ใหญ่เกิน 2 MB');const raw=JSON.parse(await file.text()),next=Circuit.fromJSON(raw);if(raw.program!==undefined&&(typeof raw.program!=='string'||raw.program.length>50000))throw Error('ข้อมูลโปรแกรมไม่ถูกต้อง');if(raw.initial!==undefined&&(typeof raw.initial!=='string'||raw.initial.length>20000))throw Error('ค่าเริ่มต้นไม่ถูกต้อง');if(raw.program)CPU.parse(raw.program).forEach(NetSim.encode);if(raw.initial)CPU.initial(raw.initial);const before=Circuit.clone(graph);graph=next;if(raw.program)code=raw.program;if(raw.initial)initial=raw.initial;preset=raw.preset in PRESETS?raw.preset:'custom';selection=null;mode='edit';commit(before,'นำเข้าวงจรแล้ว');fit()}catch(error){toast('Import ไม่สำเร็จ: '+error.message)}el.value=''}
});
document.addEventListener('keydown',e=>{if($('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();e.shiftKey?redo():undo();return}if((e.ctrlKey||e.metaKey)&&key==='y'){e.preventDefault();redo();return}if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();exportJSON();return}if((e.ctrlKey||e.metaKey)&&key==='o'){e.preventDefault();$('#import-input').click();return}if(e.key===' '){e.preventDefault();space=true;renderTools()}else if(key==='v')setTool('select');else if(key==='h')setTool('pan');else if(key==='w')setTool('wire');else if(key==='f')fit();else if(e.key==='Escape'){closeLibrary();pending=null;selection=null;$('.menu-popover')?.remove();render()}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection()}else if(e.key==='ArrowRight'){e.preventDefault();changeCycle(cursor+1)}else if(e.key==='ArrowLeft'){e.preventDefault();changeCycle(cursor-1)}});
document.addEventListener('keyup',e=>{if(e.key===' '){space=false;renderTools()}});window.addEventListener('blur',()=>{space=false;renderTools()});
let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const rect=$('#scene').getBoundingClientRect();if(rect.width&&rect.height){const centerY=camera.y+camera.h/2;camera.h=camera.w*rect.height/rect.width;camera.y=centerY-camera.h/2;updateCamera()}},60)}).observe($('#canvas-wrap'));
recalculate(false);requestAnimationFrame(()=>{fit();if(!storageEnabled)toast('หากบันทึกใน browser ไม่ได้ ใช้ Export JSON เพื่อเก็บงาน')});

// A real divider changes both columns without changing the circuit or editor contents.
(()=>{
 const workspace=$('.workspace'),handle=$('#panel-resizer');
 const desktop=matchMedia('(min-width: 601px)');
 let ratio=.66,dragging=false;
 try{const saved=Number(localStorage.getItem('datapath-panel-ratio'));if(saved>=.2&&saved<=.8)ratio=saved}catch{}
 function limits(){
  const width=workspace.clientWidth-28-handle.offsetWidth;
  return {width,min:Math.min(300,width*.45),max:width-Math.min(280,width*.45)};
 }
 function apply(left){
  if(!desktop.matches)return;
  const {width,min,max}=limits();if(width<=0)return;
  const value=Math.max(min,Math.min(max,left??width*ratio));
  workspace.style.setProperty('--panel-left',value+'px');
  handle.setAttribute('aria-valuemin',Math.round(min/width*100));
  handle.setAttribute('aria-valuemax',Math.round(max/width*100));
  handle.setAttribute('aria-valuenow',Math.round(value/width*100));
  handle.setAttribute('aria-valuetext','พื้นที่วงจร '+Math.round(value/width*100)+'%');
  return value/width;
 }
 function persist(){try{localStorage.setItem('datapath-panel-ratio',String(ratio))}catch{}}
 handle.addEventListener('pointerdown',e=>{
  if(e.button!==0||!desktop.matches)return;
  e.preventDefault();dragging=true;handle.focus();handle.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing-panels');
 });
 handle.addEventListener('pointermove',e=>{
  if(!dragging)return;
  ratio=apply(e.clientX-workspace.getBoundingClientRect().left-14-handle.offsetWidth/2)??ratio;
 });
 function finish(){if(!dragging)return;dragging=false;document.body.classList.remove('resizing-panels');persist()}
 handle.addEventListener('pointerup',finish);
 handle.addEventListener('pointercancel',finish);
 handle.addEventListener('lostpointercapture',finish);
 handle.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!desktop.matches)return;
  e.preventDefault();e.stopPropagation();const {min,max}=limits();
  const current=$('#board-panel').getBoundingClientRect().width;
  ratio=apply(e.key==='Home'?min:e.key==='End'?max:current+(e.key==='ArrowRight'?24:-24))??ratio;persist();
 });
 handle.addEventListener('dblclick',()=>{ratio=.66;apply();persist()});
 $('#code-pane').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setCodeOpen(false)}});
 new ResizeObserver(()=>apply()).observe(workspace);
 apply();
})();

(() => {
  const side = document.querySelector(".side-column");
  const editor = document.querySelector("#code-pane");

  if (!side || !editor || side.querySelector(".right-pane-resizer")) {
    return;
  }

  const divider = document.createElement("div");
  divider.className = "right-pane-resizer";
  divider.tabIndex = 0;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "horizontal");
  divider.setAttribute("aria-label", "ปรับขนาดช่องเขียนคำสั่งและคำอธิบาย");

  editor.after(divider);

  let ratio = 0.5;
  let dragging = false;
  const desktop = matchMedia("(min-width: 601px)");

  function resize(height) {
    if (!desktop.matches || !side.classList.contains("code-open")) {
      return;
    }

    const available = side.clientHeight - divider.offsetHeight;
    if (available <= 0) return;

    const minTop = Math.min(140, available * 0.4);
    const minBottom = Math.min(120, available * 0.4);
    const top = Math.max(
      minTop,
      Math.min(available - minBottom, height ?? available * ratio)
    );

    ratio = top / available;
    side.style.setProperty("--code-height", `${top}px`);

    divider.setAttribute("aria-valuemin", Math.round(minTop / available * 100));
    divider.setAttribute("aria-valuemax", Math.round((available - minBottom) / available * 100));
    divider.setAttribute("aria-valuenow", Math.round(ratio * 100));
  }

  divider.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    event.preventDefault();
    dragging = true;
    divider.focus();
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-right-panes");
  });

  divider.addEventListener("pointermove", event => {
    if (!dragging) return;

    resize(
      event.clientY -
      side.getBoundingClientRect().top -
      divider.offsetHeight / 2
    );
  });

  function finish() {
    dragging = false;
    document.body.classList.remove("resizing-right-panes");
  }

  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
  divider.addEventListener("lostpointercapture", finish);

  divider.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;

    event.preventDefault();
    event.stopPropagation();

    resize(editor.getBoundingClientRect().height +
      (event.key === "ArrowDown" ? 20 : -20));
  });

  divider.addEventListener("dblclick", () => {
    ratio = 0.5;
    resize();
  });

  new ResizeObserver(() => resize()).observe(side);
  new MutationObserver(() => resize()).observe(side, {
    attributes: true,
    attributeFilter: ["class"]
  });

  resize();
})();
