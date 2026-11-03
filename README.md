# AutoPath
### เว็บไไซต์และสื่อการสอนการทำงานของ Datapath

จัดทำขึ้นสำหรับโปรเจควิชา Computer Architecture
กลุ่ม
673040122-5	กิตติภพ โสภา
673040387-9	ดุลยเดช พวงจำปี
673040392-6	ปัณฑารีย์ สมนึกในธรรม
673040639-8	อัญชิสา แฮนเกตุ


เว็บไซต์
https://auto-path-swart.vercel.app/cad/

ไฟล์วิดีโอสื่อการสอน
https://drive.google.com/drive/u/0/folders/1ngEmvzkf19Y59t7LkMWJicSb4AA9KFxM

วิธีรันใน local
ใช้ไฟล์ index.html ที่ ./root ได้เลย


### กลุ่ม R-type
> **รูปแบบ:** `op $rd, $rs, $rt`

| คำสั่ง | ความหมาย |
| :--- | :--- |
| **add** | `rd = rs + rt` |
| **sub** | `rd = rs - rt` |
| **and** | `rd = rs AND rt` (ระดับบิต) |
| **or** | `rd = rs OR rt` (ระดับบิต) |
| **nor** | `rd = NOT (rs OR rt)` |
| **slt** | ถ้า `rs < rt` (แบบมีเครื่องหมาย) ได้ `rd = 1` ถ้าไม่ `rd = 0` |

---

### กลุ่ม Memory
> **รูปแบบ:** `op $rt, offset($rs)` โดย `address = rs + offset`

| คำสั่ง | ความหมาย |
| :--- | :--- |
| **lw** | โหลด word จาก memory เข้า `rt` |
| **sw** | เก็บค่าใน `rt` ลง memory |

---

### กลุ่ม Control flow

| คำสั่ง | ความหมาย |
| :--- | :--- |
| **beq $rs, $rt, label** | ถ้า `rs == rt` กระโดดไปที่ `label` (ถ้าไม่เท่ากันทำคำสั่งถัดไป) |
| **j label** | กระโดดไปที่ `label` โดยไม่สนเงื่อนไข |


ไฟล์ทั้งหมดในโปรเจกต์
โครงหลัก (ลำดับการโหลดตาม cad/index.html)
ไฟล์	หน้าที่
index.html (root)	หน้าส่งต่อ มีแค่ location.replace('./cad/') เพื่อเด้งไปหน้าเว็บจริง
engine.js	สมองฝั่ง MIPS ชื่อ object CPU ทำหน้าที่ 5 อย่าง: (1) parse แปลง assembly เป็นคำสั่งพร้อมตรวจ operand, label, ขนาด immediate (2) initial อ่านค่าเริ่มต้น เช่น $t0=5, [256]=42 (3) alu คำนวณ add/sub/and/or/nor/slt (4) control สร้างค่าสัญญาณ control 13 ตัวตาม state (5) มี multi และ pipeline ซึ่งเป็นตัวจำลองแบบเก่า (ผมไม่ได้ตรวจว่าหน้าเว็บใช้หรือไม่)
cad/model.js	โครงสร้างข้อมูลของวงจร ชื่อ Circuit เก็บนิยามอุปกรณ์ทุกชนิด (ขนาด รูปร่าง ตำแหน่งและจำนวนบิตของแต่ละขา), baseline() สร้างวงจรต้นแบบตามรูปข้อสอบ, คำนวณเส้นทางสายหักมุมฉาก, validate() ตรวจวงจร และ fromJSON() ตรวจไฟล์ที่ import
cad/simulator.js	ตัวจำลองวงจร ชื่อ NetSim แปลง assembly เป็น machine code 32 บิต (encode) และถอดกลับ (decode) แล้วจำลองทีละ clock cycle ตามสายที่ต่อจริง ผลลัพธ์เป็น "เฟรม" ต่อ cycle ที่เก็บค่าทุกสาย สายที่ active ค่า control และเหตุการณ์
cad/workspace.js	UI ทั้งหมด (ไฟล์ใหญ่สุด ~65 KB) วาด SVG, โหมด Learn/Edit, ลากย้ายและต่อสาย, ซูม/เลื่อน, Undo/Redo, แผง inspector ขวา, timeline ของ state, ช่องเขียนโค้ด, dialog ต่างๆ (ตาราง control, ต้นฉบับข้อสอบ, trace, help), Import/Export JSON/SVG, บันทึก localStorage, ปุ่มลัด และแถบลากปรับความกว้างแผง
cad/cases.js	สูตรวงจรตัวอย่าง 13 แบบ แต่ละแบบคือฟังก์ชัน recipe(g) ที่แก้วงจรต้นแบบเล็กน้อย (ย้ายสาย เปลี่ยนต้นทาง เพิ่ม MUX แก้ค่า control) พร้อมคำอธิบาย: change, why, takeaway, experiment, โค้ดที่ใช้ทดลอง ผลที่ได้ตัวจำลองคำนวณเองทั้งหมด
cad/casebook.js	ตัวเชื่อมคลังตัวอย่างกับ UI แสดงแกลเลอรีกรองตามประเภท (ถูก/ข้อแลกเปลี่ยน/พัง/hazard) แยกงานของผู้ใช้ออกจากตัวอย่างที่กำลังลอง เพื่อไม่ให้ทับงานเดิม และเก็บ draft ใน localStorage
หน้าตา
ไฟล์	หน้าที่
cad/index.html	โครงหน้าเว็บ: header, แถบ instruction, timeline, ปุ่มเครื่องมือ, <svg id="scene"> ที่เป็นพื้นวาดวงจร, ช่องโค้ด, inspector และ statusbar
cad/workspace.css	สไตล์หลัก (~42 KB) ของ layout และสีสายทั้งหมด
cad/cases.css	สไตล์ของแกลเลอรีตัวอย่างวงจร



