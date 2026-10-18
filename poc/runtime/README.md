# PoC #2 — Pipeline ที่ compile ตอน build เร็วแค่ไหน

คำถาม: ถ้า compile auth, validation, handler และ serializer ของแต่ละ route ให้เป็นฟังก์ชันเส้นตรงฟังก์ชันเดียวตั้งแต่ตอน build (ไม่มี middleware chain ตอนรัน) จะเร็วกว่า Hono และ Elysia และเข้าใกล้ Go ได้แค่ไหน

## ผลลัพธ์ (1 core ต่อ server, req/s ค่ามัธยฐานจาก 3 รอบ × 10 วินาที)

| Server | `/health` | `GET /users/:id` | `POST /users` | p99 (GET) | RAM |
|---|---|---|---|---|---|
| **ของเรา บน Bun** | **66,144** | **44,430** | **27,762** | 4.1 ms | 35 MB |
| Elysia (Bun) | 68,763 | 41,178 | 20,881 | 4.1 ms | 55 MB |
| Hono (Bun) | 45,429 | 21,966 | 18,232 | 5.9 ms | 50 MB |
| Go net/http (1 core) | 28,584 | 27,875 | 21,260 | 6.1 ms | 14 MB |
| **ของเรา บน Node** | **20,719** | **20,144** | **16,458** | 5.0 ms | 92 MB |
| Hono (Node) | 19,077 | 14,430 | 11,784 | 8.4 ms | 101 MB |
| เพดาน: Bun.serve เปล่า | 70,203 | – | – | – | 28 MB |
| เพดาน: node:http เปล่า | 21,613 | – | – | – | 77 MB |

`GET /users/:id` = ตรวจ token + ตรวจสิทธิ์ + validate param + ค้นข้อมูล + กรอง field ออก (ไม่ส่ง `passwordHash`)
`POST /users` = ตรวจ token + ตรวจสิทธิ์ + ตรวจ Content-Type + parse JSON + validate body 3 field

## สรุปเทียบเกณฑ์

- **ไม่ช้ากว่า Hono และ Elysia บนรันไทม์เดียวกัน: ผ่าน**
  - เทียบ Hono บน Bun: GET เร็วกว่า 2.0 เท่า, POST 1.5 เท่า
  - เทียบ Elysia: GET เร็วกว่า 8%, POST 33%, `/health` ใกล้เคียงกัน (ต่างกันอยู่ในช่วง noise)
  - เทียบ Hono บน Node: GET เร็วกว่า 1.4 เท่า, POST 1.4 เท่า
- **อยู่ในระยะ 80% ของ Go บน Bun: ผ่าน (เกินเป้า)** ต่อ 1 core เร็วกว่า Go net/http ทุก endpoint (GET 1.6 เท่า, POST 1.3 เท่า)
- **Overhead ของเฟรมเวิร์ก:** `/health` ได้ 94% ของ Bun.serve เปล่า และบน Node ได้ 96% ของ node:http เปล่า

ทุก server ผ่าน conformance test 15/15 ข้อก่อนวัด (สถานะเดียวกัน, กรอง field เหมือนกัน, กัน mass assignment และ `__proto__`) จึงมั่นใจได้ว่าทำงานเท่ากันจริง ของเรายังทำงาน**มากกว่า**อีกเล็กน้อย คือส่ง security headers สองตัวในทุก response และตรวจ Content-Type แบบเข้มงวด (ตอบ 415)

## สิ่งที่เรียนรู้ระหว่างทำ

รอบแรก `/health` ได้แค่ 51k req/s ช้ากว่า Elysia เพราะ pipeline ที่ generate ออกมาเป็น `async` ทุก route ทำให้สร้าง Promise ทุก request หลังเปลี่ยนให้ route ที่ไม่อ่าน body เป็นฟังก์ชัน sync (สร้าง Promise เฉพาะเมื่อ handler ของผู้ใช้เป็น async) ตัวเลขขึ้นเป็น 66k (+30%) และ GET +10% ผลรอบแรกเก็บไว้ใน `results-round1.json`

## ข้อจำกัดที่ต้องรู้ (สำคัญ)

- **ทดสอบแบบ 1 core ต่อ server** ซึ่ง Go เสียเปรียบ ในงานจริง Go ใช้ทุก core อัตโนมัติ ส่วน Bun และ Node ต้องเปิดหลาย process เอง เครื่องนี้มีแค่ 2 vCPU จึงทดสอบ multi-core ไม่ได้
- Go ใช้ `net/http` + `encoding/json` จาก standard library ถ้าใช้ไลบรารีที่เร็วกว่า (เช่น fasthttp) ตัวเลขของ Go จะสูงขึ้นมาก
- **Go ใช้ RAM น้อยที่สุด** (14 MB เทียบกับของเรา 35 MB)
- เป็นการทดสอบระดับ micro-benchmark ไม่มีฐานข้อมูล ในงานจริงที่มี DB ความต่างระหว่างเฟรมเวิร์กจะเล็กลง
- VM แชร์กัน ตัวเลขแต่ละรอบแกว่งได้ราว ±10% (ดู `runs` ใน `results.json`)
- Compiler ใน PoC รองรับเฉพาะ schema แบบง่าย (string, email, int, bool, object ชั้นเดียว)

## สภาพแวดล้อม

2 vCPU, server ถูก pin ไว้ที่ CPU 0 และ wrk ที่ CPU 1 (`-t1 -c64`), Bun 1.4.2, Node 22.22, Go 1.24.7 (`GOMAXPROCS=1`), Hono 4.13.13, Elysia 1.4.30, Zod 4.6.7

## รันเอง

```bash
npm install
(cd servers/go && go build -o server .)
node hyper/compile.mjs hyper-app/app.mjs dist   # build step: สร้าง dist/bun.mjs และ dist/node.mjs
node conform.mjs                                # ตรวจว่าทุก server ทำงานเหมือนกัน
node bench.mjs                                  # ต้องมี wrk และ taskset, ใช้เวลาราว 13 นาที
```

## ไฟล์สำคัญ

- `hyper-app/app.mjs` — สิ่งที่ผู้ใช้เขียน (route, auth, schema)
- `hyper/compile.mjs` — compiler: ตรวจความปลอดภัยตอน build, แปลงสิทธิ์เป็น bitmask, generate validator และ serializer
- `dist/bun.mjs`, `dist/node.mjs` — โค้ดที่ generate ออกมา (อ่านดูได้ว่าแต่ละ route เป็นฟังก์ชันเส้นตรง)
- `servers/` — Hono, Elysia, Go และ baseline
- `conform.mjs`, `bench.mjs` — ชุดตรวจและชุดวัดผล
