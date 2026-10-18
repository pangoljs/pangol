# PoC #3 — Parser แบบเข้มงวด, fuzz test และ regression test จาก CVE จริง

คำถาม: parser ที่ "ปฏิเสธทุกอย่างที่กำกวม" กันช่องโหว่ประเภทเดียวกับที่ Hono, Fastify และ Elysia เคยเจอได้ครบไหม และทำให้ช้าลงเกิน 5% หรือไม่

## สรุปผล

| เกณฑ์ | ผล |
|---|---|
| กัน CVE จริงของ Hono, Fastify, Elysia | **ผ่าน** regression test 13/13 |
| Fuzz test (สุ่ม input ~24 ล้านชุด) | **ผ่าน** หลังแก้บั๊ก 3 จุดที่ fuzzer เจอ |
| ช้าลงไม่เกิน 5% บน Node | **ผ่าน** (วัดไม่พบความต่าง: −0.1% ถึง +3.5%, อยู่ในช่วง noise) |
| ช้าลงไม่เกิน 5% บน Bun | **เกือบผ่าน** `/health` +1.3%, POST −3.9%, GET −5.1% |

## 1. Regression test จาก CVE จริง (`tests/cve.test.mjs`)

| CVE | ช่องโหว่เดิม | กฎของเรา |
|---|---|---|
| Hono CVE-2025-58362 | `getPath()` ใช้ offset ตายตัว ทำให้ path ที่ proxy ตรวจกับที่แอปเห็นไม่ตรงกัน | path จะผ่านได้ก็ต่อเมื่อ**ตรงกับที่ URL parser มาตรฐานเห็นทุกตัวอักษร** ไม่งั้นตอบ 400 ใช้ input ชุดเดียวกับเทสต์ใน commit ที่ Hono แก้ไข |
| Fastify CVE-2025-32442 | Content-Type ที่ต่างนิดเดียวเลือก parser JSON แต่ไม่เลือก schema ทำให้ข้าม validation | Content-Type ถูก parse ครั้งเดียวแล้วใช้ค่าเดียวกันตัดสินทุกอย่าง ทดสอบ 24 รูปแบบ ไม่มีรูปแบบไหนข้าม validation ได้ |
| Elysia CVE-2026-56669 | normalize multipart ด้วย `getAll()` ทีละ key ทำให้ใช้เวลาแบบกำลังสอง | parse รอบเดียวด้วย Map และจำกัด 100 parts จำนวน field เพิ่ม 8 เท่า เวลาเพิ่ม ~8 เท่า (เส้นตรง) |

เทสต์เพิ่มเติม: prototype pollution (รวมถึงสะกดด้วย `\u005f`), duplicate key, JSON ซ้อนลึก 1 ล้านชั้น (ปฏิเสธใน <2 ms ไม่ stack overflow), จำนวน key/item เกินลิมิต, path traversal ใน multipart filename, ReDoS ใน email regex

**รูปแบบ path ที่ใช้เลี่ยง `/admin` ได้ซึ่งถูกปฏิเสธทั้งหมด (27 แบบ):** `/public/../admin`, `/%61dmin`, `//admin`, `/admin%2F`, `/admin%5C`, `/admin%00`, `/admin%c0%af`, `/admin/.` และอื่นๆ

## 2. Fuzz test (`tests/fuzz.test.mjs`, fast-check)

กำหนด "สิ่งที่ต้องจริงเสมอ" 6 ข้อ แล้วให้ fast-check สุ่ม input มาทดสอบ:

1. path ที่ผ่าน = สิ่งที่ `new URL()` เห็นทุกตัวอักษร, decode แล้วไม่มี `/` `\` NUL `.` `..`
2. absolute URL ที่ผ่าน = `new URL(url).pathname` และฟังก์ชันแบบไม่ allocate (`validTarget`) ให้ผลตรงกันเสมอ
3. Content-Type: ไม่ throw และจะถือเป็น JSON เฉพาะเมื่อ media type คือ `application/json` (charset utf-8 เท่านั้น)
4. JSON ที่ถูกต้อง: ผลตรงกับ `JSON.parse` หรือถูกปฏิเสธด้วยเหตุผลที่ระบุได้เท่านั้น
5. ข้อความสุ่ม: ไม่ทำให้ parser พัง
6. multipart: round-trip ได้ครบ และข้อมูลสุ่มไม่ทำให้พัง

**บั๊กที่ fuzzer เจอและแก้แล้ว 3 จุด** (ทั้งหมดอยู่ในการอ่าน absolute URL):
- `http://a:1*` (port ไม่ถูกต้อง) เคยผ่านเป็น `/`
- `h://a` (scheme ที่ไม่ใช่ http) กฎ path ต่างจาก http
- `http://a.5` (host ที่ label สุดท้ายเป็นตัวเลข ซึ่ง URL parser ตีความเป็น IPv4) เคยผ่าน

รันครั้งสุดท้ายบนโค้ดเวอร์ชันสุดท้าย: ~24 ล้าน input ไม่มีข้อผิดพลาด (ผลอยู่ใน `fuzz-final.log`)

## 3. ต้นทุนด้านความเร็ว

**ต่อ operation** (`bench-micro.mjs`, Node / Bun):

| operation | เพิ่มขึ้น |
|---|---|
| ตรวจ path (origin-form) | ~+50–85 ns |
| ตรวจ Content-Type | ~0 ns (fast path สำหรับรูปแบบที่ใช้จริง) |
| JSON body 49 B | ~+0.4–0.6 µs |
| JSON body 7 KB | ~+45–60 µs (ราว 1.7–2.5 เท่าของ `JSON.parse`) |

**ทั้งระบบ** (wrk, 1 core, A/B สลับรอบละ 5 ครั้ง ค่ามัธยฐาน):

| | `/health` | GET user | POST user |
|---|---|---|---|
| Node | +3.5% | +3.0% | +0.5% |
| Bun (ค่าเริ่มต้น: ตรวจระดับ param) | +1.3% | −5.1% | −3.9% |
| Bun (ตรวจ `req.url` เต็มรูปแบบ) | – | −24% | – |

ตัวเลขบวกบน Node ไม่ได้แปลว่าเร็วขึ้นจริง เป็นความแกว่งของ VM

## 4. สิ่งที่ค้นพบเกี่ยวกับ Bun (1.4.2)

ระหว่างทดสอบพบพฤติกรรมของ router ในตัว Bun ที่ต้องรู้:
- ค่า param ถูก **decode แล้ว** ก่อนส่งให้ handler: `/users/4%2F2` → `id = "4/2"`, `/users/%2e%2e` → `id = ".."`, `/users/42%00` → มี NUL byte
- `req.url` ถูก **normalize** แล้ว แต่ router จับคู่จาก path ดิบ: `/users/..` ถูกส่งเข้า `/users/:id` ด้วย `id = ".."` ขณะที่ `req.url` รายงานว่า `http://x/`
- การอ่านเนื้อหาของ `req.url` ใน Bun มีต้นทุนต่อ request ราว 6–9% (อ่านแค่ `.length` ไม่เสีย)

ผลคือบน Bun เราตรวจที่ **ค่า param ทุกตัว** เป็นค่าเริ่มต้น (ถูกและได้ผล) และมีโหมด `STRICT_URL=1` สำหรับตรวจ path ดิบเต็มรูปแบบ (แพงกว่า) ข้อจำกัดของโหมดเริ่มต้นบน Bun คือ เลขที่ encode แบบไม่จำเป็น เช่น `%34%32` (= 42) ยังผ่านเข้า handler ได้ ซึ่งมีผลเฉพาะกรณีที่ proxy ตรวจสิทธิ์ตาม path ที่มี param

## 5. เทียบพฤติกรรมกับเฟรมเวิร์กอื่น (`../poc-runtime/attacks.mjs`)

request เดียวกันส่งผ่าน TCP ดิบ (สถานะที่ server ตอบ):

| การโจมตี | ของเรา Bun | ของเรา Node | Hono | Elysia | Go |
|---|---|---|---|---|---|
| encoded slash ใน param | 400 | 400 | 400 | 422 | 400 |
| `%2e%2e` ใน param | 400 | 400 | 404 | 422 | 400 |
| `%34%32` (= 42) | 200 | 400 | 200 | 200 | 200 |
| duplicate key | 400 | 400 | 201 | 201 | 400 |
| JSON ซ้อน 5,000 ชั้นใน field ที่ไม่รู้จัก | 400 | 400 | 201 | 201 | 201 |
| `__proto__` ใน body | 400 | 400 | 201 | 201 | 201 |

หมายเหตุเพื่อความยุติธรรม: "201" ของเฟรมเวิร์กอื่นในตารางนี้**ไม่ได้แปลว่ามีช่องโหว่** เพราะทั้งหมดตัด field ที่ไม่รู้จักทิ้งและไม่เกิด prototype pollution ของเราปฏิเสธตั้งแต่ชั้น parser เป็นนโยบายเชิงป้องกันหลายชั้น ส่วนหลายเคสของ param ที่ตัวอื่นตอบ 4xx เป็นเพราะ schema ของ id ในแอปทดสอบรับเฉพาะตัวเลข ถ้า schema หลวมกว่านี้ผลจะต่างออกไป

## ข้อจำกัด

- JSON pre-scan เขียนด้วย JS จึงช้ากว่า `JSON.parse` ราว 2 เท่าสำหรับ body ใหญ่ ทางแก้ระยะยาวคือ scanner แบบ native
- กฎเข้มงวดบางข้ออาจปฏิเสธ request ที่ถูกต้องแต่ไม่ใช่รูปแบบมาตรฐาน เช่น trailing slash, hex ตัวพิมพ์เล็ก (`%e0`), IPv6 host ที่ไม่ได้เขียนแบบย่อสุด ควรมีตัวเลือกให้ปรับได้
- ยังไม่ได้ทดสอบ header injection, HTTP request smuggling (เป็นหน้าที่ของรันไทม์) และ WebSocket
- ไม่ได้แทนการ audit ด้านความปลอดภัยจากบุคคลที่สาม

## รันเอง

```bash
npm install
node --test tests/cve.test.mjs tests/fuzz.test.mjs          # FUZZ_RUNS=1000000 สำหรับรอบใหญ่
node bench-micro.mjs && bun bench-micro.mjs
# ทั้งระบบ (ในโฟลเดอร์ poc-runtime):
node hyper/compile.mjs hyper-app/app.mjs dist                # strict (ค่าเริ่มต้น)
STRICT=0 node hyper/compile.mjs hyper-app/app.mjs dist-basic # แบบ PoC 2
node bench-ab.mjs get_user hyper-bun-basic hyper-bun 5
node attacks.mjs
```
