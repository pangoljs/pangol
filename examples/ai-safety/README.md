# AI เขียนพลาด → Pangol ตรวจอะไรได้บ้าง

ตัวอย่างที่รันได้เพื่อเรียนรู้การใช้ Pangol ร่วมกับ AI coding tools แยกการตรวจตอน build/check ออกจากการป้องกันตอน runtime และข้อจำกัดที่ยังต้องให้คน review ไม่มี DB, network listener หรือ provider ภายนอก ใช้ `app.fetch()` ส่ง request จริงผ่าน pipeline ใน process

ใช้ JavaScript ESM (`.mjs`) เพื่อแสดงว่า checker และ runtime ยังป้องกันได้แม้ไม่มี TypeScript ช่วยจับข้อผิดพลาด ไม่ใช่ template สำหรับ deploy; auth รับชื่อ `alice`/`bob` เป็น credential สำหรับเทสต์เท่านั้น สำหรับ login จริงดู [Keycloak + PostgreSQL](../keycloak-postgres/README.md)

## ทดลองจาก repo root

```sh
pnpm install --frozen-lockfile
pnpm --filter pangol build
pnpm --filter @pangol/example-ai-safety check
pnpm --filter @pangol/example-ai-safety test
```

ผลที่คาด: check ผ่าน 2 routes และ tests ผ่าน 10 cases รวมกรณีผิดที่ต้องถูกปฏิเสธ ถ้ามี Bun ใช้ `pnpm --filter @pangol/example-ai-safety test:bun` ได้ด้วย ทั้งสองชุดเข้า root workspace tests/CI แล้ว

`typecheck` ของตัวอย่าง JavaScript นี้เรียก `pangol check`; ไม่ได้อ้างว่า TypeScript ตรวจไฟล์เหล่านี้ ส่วน `build` เรียก `pangol build` กับ routes เดียวกัน

## โค้ดที่ใช้เป็นหลักฐาน

- [GET /posts/:id](src/routes/posts/[id].get.mjs): ประกาศ auth, params, load, owner และ response; คืน record เต็มผ่าน `c.resource`
- [POST /posts](src/routes/posts/index.post.mjs): คืน draft จาก input ที่ผ่าน schema เพื่อดูว่า field ที่ handler ได้รับมีอะไรบ้าง ไม่บันทึกข้อมูล
- [Model](src/models.mjs): มี `internalNote` ที่ประกาศ `.private()` และข้อมูลใน Map
- [Tests](test/safety.test.mjs): เรียก CLI จริงและ request pipeline ไม่จำลองผล checker

| ข้อผิดพลาดที่จำลอง | ตรวจเมื่อไร | หลักฐานที่ต้องได้ |
|---|---|---|
| ลบ `auth` | check/build | exit 1 พร้อม C1 และชื่อไฟล์ |
| ลบ `response` | check/build | exit 1 พร้อม C2 |
| handler อ่าน `c.body` แต่ลบ body schema | check/build (วิเคราะห์ handler) | exit 1 พร้อม C3 |
| ลบ owner จาก protected route ที่มี path param | check/build | exit 1 พร้อม C6 |
| เปลี่ยน `Post.public()` เป็น `Post` ซึ่งมี private field | check/build | exit 1 พร้อม C10 |
| ไม่ส่ง credential หรือส่งค่าปลอม | runtime | 401; credential ถูกต้องและเป็นเจ้าของได้ 200 |
| Bob อ่าน post ของ Alice | runtime | 404 และ body เหมือน record ที่ไม่มีจริง |
| handler คืน record เต็มที่มี internalNote | runtime | response มีเฉพาะ id/title/ownerId; ไม่มี internalNote |
| title เป็น number | runtime | 400; title string ที่ถูกต้องผ่าน |
| client ส่ง ownerId/isAdmin/internalNote เพิ่ม | runtime | field ที่ไม่ประกาศถูกตัด ไม่ใช่การปฏิเสธ request ทั้งก้อน; ownerId มาจากผู้ใช้ที่ผ่าน auth |
| ประกาศ public ผิดตามเจตนาธุรกิจ พร้อม handler ที่ไม่อ่าน user | **ตรวจเจตนาไม่ได้** | check ผ่านและ anonymous ได้ 200; เป็น counterexample ที่ตั้งใจทดสอบ |

เทสต์กรณีผิดสร้างสำเนา source ใน temporary directory แล้วแก้ทีละจุด เรียก `pangol check` และตรวจ rule/exit code ก่อนลบสำเนา จึงไม่มี route ที่ตั้งใจผิดปะปนในแอปตัวอย่างที่ build ผ่าน การตรวจกรณีถูกใช้ source เดียวกันก่อนแก้ เพื่อให้เห็นทั้งสิ่งที่ต้องจับและสิ่งที่ต้องปล่อยผ่าน

## สิ่งที่หลักฐานนี้ไม่ได้รับประกัน

- **public ไม่เท่ากับลืม auth:** การประกาศ public เป็นคำสั่งที่ถูกต้องตาม API; framework ไม่รู้ว่า endpoint นั้นควรเป็นข้อมูลลับ กรณีสุดท้ายใน tests แสดงขอบเขตนี้อย่างชัดเจน
- **มี owner ไม่เท่ากับ owner ถูก:** คนต้อง review predicate; `owner: 'none'`/`'query'` เป็นการเลือกที่ต้องตรวจ query เอง การตรวจ record รายตัวไม่ทำให้รายการข้อมูลถูกกรองตามผู้ใช้โดยอัตโนมัติ
- **private ต้องประกาศถูก:** Pangol ไม่รู้เองว่าข้อมูลธุรกิจใดเป็นความลับ ถ้าประกาศ field อ่อนไหวใน response โดยไม่ติด private ก็อาจส่งออกได้
- **input schema ไม่แทน SQL parameterization หรือ transaction:** ชุดนี้ไม่ได้พิสูจน์ว่า SQL หรือกฎธุรกิจปลอดภัย
- **checker ไม่ใช่ตัวพิสูจน์โปรแกรม:** กฎวิเคราะห์ handler ไม่เข้าใจตรรกะทุก helper หรือโค้ด dynamic ต้องมี tests ของแอปเอง
- **ไม่ใช่ผลประเมิน AI หรือ security audit:** ตัวอย่างเหล่านี้เขียนขึ้นเพื่อสาธิตข้อผิดพลาดที่ AI หรือคนอาจทำ ไม่ใช่ output จากการทดลองโมเดล ไม่ใช่หลักฐานว่า AI เขียนได้ปลอดภัยกว่าทุก framework

## ใช้กับงานที่ AI เขียนจริง

ให้ AI ระบุว่าใครเรียก route ได้, input ที่ยอมรับ, field ที่ส่งออก และเงื่อนไขเจ้าของก่อนเขียนโค้ด จากนั้นรัน check/build และ tests ของธุรกิจที่มีทั้งเจ้าของ ผู้ใช้อื่น และ anonymous

review การเปลี่ยน auth/owner/response ผ่าน `pangol diff` เทียบ branch ฐานด้วย แต่ผล diff เป็นข้อมูลช่วย review ไม่ใช่การอนุมัติความปลอดภัยแทนคน สำหรับกฎที่ diff ตรวจอยู่ดู [SPEC หัวข้อ 10](../../docs/SPEC.md)
