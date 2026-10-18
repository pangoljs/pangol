# PoC #5 — `owner` rule + security manifest diff for PR review

คำถาม:
1. ถ้าบังคับให้ route ที่มี `[id]` ประกาศ `owner` และสร้าง security manifest แล้ว diff ใน PR จะยกช่องโหว่ที่เข้ามากับ PR ขึ้นมาให้คน review เห็นได้แค่ไหน และเตือนผิดบ่อยแค่ไหน
2. AI เรียนรู้ API `load` / `owner` จากเอกสารได้ไหม

## สรุปผล

| | ผล |
|---|---|
| PR ที่มีช่องโหว่ 18 แบบ | **ยกขึ้นมาได้ 18/18** (🔴 7, 🟡 11) หลังแก้กฎ 1 ข้อ; ก่อนแก้ได้ 17/18 |
| PR ที่ปลอดภัย 10 แบบ | **🔴 เตือนผิด 0**, 🟡 4 (noise), เงียบ 6 |
| ช่องโหว่ถูกยืนยันว่าเป็นของจริงด้วย hidden test | 12 จาก 12 แบบที่มีเทสต์ครอบคลุม (อีก 6 แบบยืนยันจากการอ่านโค้ด) |
| AI ใช้ API owner | Sonnet/Opus ใช้ owner rule ถูกทุก route, Haiku ใช้ `owner: 'none'` แล้วเช็คใน handler (ทำงานถูก แต่ manifest ขึ้น 🔴) ทั้ง 3 รุ่นผ่าน hidden test 36/36 |

## สิ่งที่เพิ่มในเฟรมเวิร์ก

- `load` / `owner` / `c.resource`: ลำดับ auth → validate → load (ไม่เจอ = 404) → owner (ไม่ผ่าน = 404) → handler
- build check: route ที่มี path param และไม่ใช่ public ต้องประกาศ `owner` (function, `'none'` หรือ `'query'`), owner function ต้องมี `load`
- `hyperflat check --manifest out.json` — manifest สร้างจาก route object ที่โหลดจริง (รวมผลของ helper)
- `hyperflat diff before.json after.json` และ `hyperflat diff main..HEAD` / `hyperflat diff main` (เทียบกับ working tree), `--fail-on high`, `--json`
- กฎของ diff: auth ที่อ่อนลง, owner ที่หายหรือเปลี่ยน (แสดง source ก่อน/หลัง รวม helper ที่ import มา), field ใหม่ใน response (🔴 ถ้าชื่อดูเป็นความลับ), field ใน body/query ที่เป็นเจ้าของ/สิทธิ์/เงิน (🔴) หรืออ้างถึง record อื่น (🟡), list ที่ handler เปลี่ยน, rate limit ที่หายไป, `auth.js` ที่เปลี่ยน, route ที่ถูกลบ

## ผล PR suite (`eval/`)

| PR | ชนิด | ผล |
|---|---|---|
| V01 owner rule → `'none'` | IDOR path | 🔴 |
| V02 owner rule เหลือแค่ "login แล้ว" | IDOR path | 🟡 (แสดง rule ก่อน/หลัง) |
| V03 `owner: 'query'` แต่ไม่ได้กรองจริง | IDOR path | 🟡 |
| V04 helper `_guards.js` ถูกทำให้อ่อนลง | IDOR path | 🟡 ทั้ง 2 route ที่ใช้ helper |
| V05 permission → user | auth อ่อนลง | 🔴 |
| V06 body รับ `role` | mass assignment | 🔴 |
| V07 body รับ `userId` | mass assignment | 🔴 |
| V08 body รับ `price` | mass assignment | 🔴 |
| V09 body รับ `addressId` ไม่ตรวจเจ้าของ | IDOR body | 🟡 |
| V10 response เพิ่ม `paymentToken` | ข้อมูลรั่ว | 🔴 |
| V11 response เพิ่ม `credentials` (= password hash) | ข้อมูลรั่ว | 🟡 (ชื่อไม่ดูเป็นความลับ) |
| V12 list เลิกซ่อน draft ของคนอื่น | IDOR list | 🟡 |
| V13 list เพิ่ม `?includeDrafts` | IDOR list | 🟡 |
| V14 PATCH /posts รับ `id` ใน body | IDOR body | 🟡 (**พลาดในรอบแรก** แก้กฎแล้ว) |
| V15 public GET /users/export | auth อ่อนลง | 🟡 |
| V16 ลบ rate limit | abuse | 🟡 |
| V17 `auth.js` รับ token ปลอม | auth อ่อนลง | 🔴 |
| V18 อ่าน id จาก query ข้าม load/owner | IDOR path | 🟡 |
| B02 public GET /version, B04 refactor list, B06 เพิ่ม field ใน list, B07 เปลี่ยนชื่อตัวแปรใน helper | ปลอดภัย | 🟡 noise |
| B01, B03, B05, B08, B09, B10 | ปลอดภัย | เงียบ / ✓ |

## ข้อจำกัด (สำคัญ)

- **🟡 ไม่ได้แปลว่าเครื่องมือตัดสินให้** หลายข้อ (V02, V03, V12) diff บอกได้แค่ว่า "ตรงนี้เปลี่ยน ไปดู" คนยังต้องอ่านโค้ด และ **V12 (มีช่องโหว่) กับ B04 (refactor ปลอดภัย) ได้ข้อความเดียวกันทุกตัวอักษร**
- **ชุด PR ผมเขียนเองพร้อมกับกฎ** จึงเสี่ยงลำเอียง และกฎข้อ "id ใน body" ถูกเพิ่มหลังเห็นว่า V14 หลุด ผล 18/18 จึงเป็นผลบนชุดที่ใช้ปรับกฎแล้ว ยังไม่มีชุดทดสอบแยก (held-out)
- กฎหลายข้อพึ่งชื่อ field (เช่น `role`, `price`, `token`) ถ้าตั้งชื่อหลบ (V11) จะตกลงมาเป็น 🟡 แทน 🔴 และ login ที่คืน `token` ตามปกติก็จะขึ้น 🔴 ตอนเพิ่ม route ใหม่
- `auth.js` import `db.js` การแก้ db layer ใดๆ จะขึ้น 🔴 "authentication logic changed" ซึ่งอาจเป็น noise
- เปลี่ยนแค่ชื่อพารามิเตอร์ใน owner rule (B07) ก็ขึ้น 🟡 เพราะเทียบจาก source
- Haiku เลือก `owner: 'none'` + เช็คใน handler แสดงว่าเอกสารยังไม่ชี้นำพอ ควรให้ build check เตือนเมื่อ handler ตอบ 403 ใน route ที่ owner เป็น `'none'`
- ยังไม่ได้ทดสอบกับ PR จริงจากทีม และยังไม่ได้ทดสอบแบบ adversarial

## รันเอง

```bash
npm install
cd app && npx hyperflat check --manifest ../m.json && cd ..
node eval/run-suite.mjs                 # 28 PR จำลอง, ผลอยู่ใน eval/work/*.md
TESTS=./tests2.mjs node score.mjs runs/own-sonnet hyper task05 task06 task07 task08 task09
```

---

## รอบที่ 2: หลังการตรวจโค้ดจากภายนอก (external review)

ผู้ตรวจภายนอกอ่านโค้ดแล้วพบปัญหา 2 กลุ่ม ซึ่งตรวจสอบแล้วว่าถูกต้องทุกข้อ:

**1. ต้นเหตุที่ Haiku ใช้ `owner: 'none'`:** `HYPERFLAT.md` ยังมีข้อความเก่าที่สั่งให้ "เช็คเจ้าของใน handler แล้วตอบ 403" และตัวอย่างโค้ดเก่าค้างอยู่ ขัดกับหัวข้อ owner ที่เพิ่มเข้ามาใหม่ หลังแก้เอกสาร Haiku ทำใหม่ 2 รอบ **ใช้ owner rule ถูกทุก route ทั้ง 2 รอบ** (36/36 และ 35/36 ข้อที่พลาดคือตั้งชื่อ query เป็น `?author=` ซึ่งสเปกเปิดให้ตีความได้)

**2. ช่องว่างในกฎ diff (RT-01 ถึง RT-06):** นำมาเป็น PR ทดสอบ R01–R06 ซึ่งเป็น**ชุดทดสอบแยกชุดแรก** เพราะคนอื่นเขียน

| | กฎเดิมที่ freeze ไว้ | หลังแก้กฎ |
|---|---|---|
| R01 load แก้ field เจ้าของ | เงียบ | 🟡 load changed (แสดง source ก่อน/หลัง) |
| R02 load ของตัวเอง แต่ลบ `c.params.id` | เงียบ | **blocked**: handler ไม่ใช้ `c.resource` |
| R03a ลบการล็อกบัญชีใน login | เงียบ | ℹ handler changed (**ยังถือว่าหลุด**) |
| R03b handler ใส่ role admin เอง | เงียบ | ℹ handler changed (**ยังถือว่าหลุด**) |
| R04 route ใหม่ owner `() => true` | ✓ เขียว | **blocked** (handler ไม่ใช้ `c.resource`); R04b ที่ใช้ `c.resource`: 🔴 owner rule ไม่ดูผู้เรียก |
| R05 route ใหม่รับ `?userId=` | ✓ เขียว | 🔴 |
| R06 list ห่อด้วย `{items,total}` + ลบตัวกรอง | 🟡 (บังเอิญจาก response เปลี่ยน) | 🔴 handler ไม่ใช้ `c.user` แล้ว |

**ผลสำคัญ:** กฎเดิม**จับชุดทดสอบแยกได้แค่ 1/7** ตัวเลข 18/18 ในรอบแรกจึงสูงเกินจริงเพราะคนเดียวเขียนทั้งกฎและ PR ทดสอบ

**สิ่งที่แก้:**
- build check: route ที่มี `load` ต้องใช้ `c.resource` ใน handler, `owner: 'none'` ห้าม handler ตอบ 403 เอง
- manifest/diff: ติดตาม `load` (hash + source), แสดง source ของ owner/load ใน route ใหม่, owner rule ที่ไม่อ้าง `c.user` = 🔴, ตรวจ query ของ route ใหม่, ตรวจ list ที่ซ้อนใน object, handler ที่เลิกอ้าง `c.user` = 🔴 (ทำให้ V12 กับ B04 แยกกันได้แล้ว), handler ที่เปลี่ยนใน route อื่น = ℹ
- `HYPERFLAT.md`: ลบคำแนะนำที่ขัดกัน และอธิบายว่าการตอบ 404 แทน 403 เป็นความตั้งใจ

**ผลรวมหลังแก้ (ชุดทดสอบทั้งหมด):** PR ที่มีช่องโหว่ 26 แบบ: block 2, 🔴 11, 🟡 11, หลุด 2 (ตรรกะธุรกิจใน handler) / PR ปลอดภัย 10 แบบ: 🔴 เตือนผิด 0, 🟡 4

**ข้อควรระวัง:** หลังแก้แล้ว R01–R06 ก็ไม่ใช่ชุดทดสอบแยกอีกต่อไป ต้องมีชุดใหม่จากคนอื่นจึงจะวัดผลจริงได้อีกครั้ง กฎ `usesUser` และ "owner ไม่อ้าง c.user" เป็น heuristic ที่เลี่ยงได้ง่าย (เช่น อ้าง `c.user` แบบไม่มีผลอะไร) ในระยะยาวควรให้ list ประกาศ `scope` (ตัวกรองแถว) แบบเดียวกับ `owner` ส่วนตรรกะธุรกิจใน handler (R03) อยู่นอกขอบเขตของ manifest โดยธรรมชาติ ยังต้องอาศัยเทสต์และคน review
