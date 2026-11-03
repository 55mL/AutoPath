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



