# PoC #1 — Type-safe RPC ที่ไม่ช้าเมื่อมีหลายพัน route

คำถาม: ถ้าสร้าง type ของ API ด้วย codegen ตอน build (type แบน) แทนการให้ TypeScript infer จากทั้งแอป (แบบ Hono RPC) IDE และ `tsc` จะเร็วขึ้นแค่ไหนเมื่อโปรเจกต์ใหญ่

## ผลลัพธ์ (2,000 route, ค่ามัธยฐานจาก 3 รอบ)

| ตัววัด | Hono RPC | ของเรา | เร็วขึ้น |
|---|---|---|---|
| Autocomplete รายการ route (IDE อุ่นแล้ว) | 49.8 s | 0.53 s | ~94x |
| Autocomplete field ของ response | 48.0 s | 0.30 s | ~160x |
| ตรวจ error หลังแก้โค้ด 1 บรรทัด | 46.4 s | 0.69 s | ~67x |
| Autocomplete ครั้งแรก (เปิด IDE ใหม่) | 49.8 s | 1.5 s | ~32x |
| `tsc` ฝั่ง client (check time) | 47.4 s | 0.77 s | ~61x |
| `tsc` ฝั่ง server (check time) | 29.1 s | 5.5 s | ~5.3x |
| หน่วยความจำ `tsc` ฝั่ง client | 2,183 MB | 123 MB | ~18x |
| Type instantiations ฝั่ง client | 11.4 ล้าน | 31.8 พัน | ~358x |
| Codegen (build ทั้งโปรเจกต์) | – | 5.3 s | ต้นทุนเพิ่ม |

การเติบโตตามขนาด (autocomplete รายการ route, IDE อุ่นแล้ว):

| Route | Hono | ของเรา |
|---|---|---|
| 100 | 2.2 s | 0.09 s |
| 500 | 8.0 s | 0.24 s |
| 2,000 | 49.8 s | 0.53 s |

ข้อมูลดิบทั้งหมดอยู่ใน `results.json`

## เทียบกับเกณฑ์ผ่าน

- `tsc` เร็วกว่า Hono อย่างน้อย 5 เท่า: **ผ่าน** (client 61x, server 5.3x)
- Autocomplete ภายใน 500 ms ที่ 2,000 route: **เกือบผ่าน** (field ของ response 0.30 s ผ่าน, รายการ route 0.53 s เกินเล็กน้อย, ครั้งแรกหลังเปิด IDE 1.5 s)

## ความถูกต้องของ type (ตรวจแล้ว)

- ฝั่ง client จับความผิดพลาดได้ครบ 7/7 กรณี: path ที่ไม่มีจริง, ชื่อ param ผิด, ไม่ส่ง params, ชนิดข้อมูลใน body ผิด, อ่าน field ที่ไม่มีใน response, ไม่ส่ง query ที่บังคับ, ค่า enum ผิด และไม่ฟ้องผิดกับการเรียกที่ถูกต้อง
- ฝั่ง server จับ param ผิดชื่อ และ handler คืนค่าผิด shape ได้
- Build check ปฏิเสธ route ที่ไม่มี `auth` หรือไม่มี `response` schema พร้อมบอกวิธีแก้

## วิธีทดสอบ

- โปรเจกต์จำลองสองแบบที่เหมือนกันทุกอย่าง: schema Zod ชุดเดียวกัน (entity 7 field ต่อ resource, ชื่อ field ไม่ซ้ำกันเพื่อไม่ให้ TS ใช้ type ซ้ำ), 10 route ต่อ resource, handler เหมือนกัน
- Hono: sub-app ต่อ resource ต่อกันด้วย `.route()` และใช้ `zValidator` ซึ่งเป็นรูปแบบที่เอกสาร Hono แนะนำ
- ของเรา: 1 ไฟล์ต่อ route ใช้ `route()` แล้ว `lib/build.ts` แปลง schema เป็น type แบนใน `.hyper/api.d.ts`
- Client ทั้งสองแบบเรียก API ชุดเดียวกัน 50 ครั้ง
- IDE วัดด้วย TypeScript Language Service ซึ่งเป็น engine เดียวกับที่ VS Code ใช้ (`bench-ls.mjs`)
- เครื่อง 2 vCPU, Node 22, TypeScript 5.9.3, Hono 4.13.13, Zod 4.6.7

## ข้อจำกัดที่ต้องรู้

- ยังไม่ได้ทดสอบวิธีลดปัญหาของ Hono เช่น export เฉพาะบาง route แยกกัน ซึ่งจะทำให้ Hono เร็วขึ้น แต่ก็ต้องจัดการ client หลายตัวเอง
- TypeScript 7 (tsgo) จะทำให้ทั้งสองแบบเร็วขึ้น แต่ปริมาณงานของ type checker ยังต่างกันหลายร้อยเท่า (instantiations)
- Codegen ใช้ 5.3 s ต่อการ build ทั้งโปรเจกต์ที่ 2,000 route ในโหมด dev ต้องทำแบบ incremental (สร้างใหม่เฉพาะไฟล์ที่แก้)
- Codegen ใน PoC รองรับเฉพาะ Zod (ผ่าน `z.toJSONSchema`) ของจริงต้องรองรับ Standard Schema ตัวอื่นด้วย
- ผลจากเครื่องเดียว ควรรันซ้ำบนเครื่อง dev จริง

## รันเอง

```bash
npm install
node gen.mjs 50                       # สร้าง 500 route ใน out/500
npx tsx lib/build.ts out/500/ours     # codegen
node bench.mjs 10 50 200              # sweep เต็ม (2,000 route ใช้เวลาราว 20 นาที)
```

## ไฟล์สำคัญ

- `lib/hyper.ts` — `route()` ฝั่ง server (Standard Schema, flat context)
- `lib/build.ts` — codegen + build check ด้านความปลอดภัย
- `lib/client.ts` — RPC client ไม่ใช้ Proxy, path เป็น string
- `gen.mjs` — สร้างโปรเจกต์จำลองทั้งสองแบบ
- `bench.mjs`, `bench-ls.mjs` — ชุดวัดผล
