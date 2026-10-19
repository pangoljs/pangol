# Handoff: งานที่เหลือของ v0.1

อัปเดต 2026-10-19 · ต่อจาก `pangol@0.1.0-alpha.0` ที่ publish แล้ว

เอกสารนี้สำหรับคนหรือ AI ที่มาทำงานต่อ อ่านคู่กับ [`AGENTS.md`](../AGENTS.md), [`SPEC.md`](SPEC.md) และ [`DECISIONS.md`](DECISIONS.md)
ทุกงานด้านล่างมี: เป้าหมาย, หัวข้อใน SPEC, แนวทางที่เสนอ, **คำถามที่ต้องถามเจ้าของโปรเจกต์ก่อนเริ่ม**, เกณฑ์ว่าเสร็จ และหลุมที่รู้แล้ว

## 1. สถานะตอนนี้

**ใช้ได้และมีเทสต์ (260 เทสต์บน Node, 250 บน Bun)**

| ส่วน | ไฟล์หลัก |
|---|---|
| `route()` + type inference ของ `c` | `src/route.ts` |
| Schema: primitive, `t.money`, `t.email`, `t.uuid`, `t.model` + `.private()` | `src/schema.ts`, `src/money.ts` |
| Validator / serializer ที่ compile จาก schema | `src/runtime/{def,validate,serialize}.ts` |
| Pipeline ตาม SPEC 3 (path → route → auth → rate limit → validate → load → owner → handler → serialize) | `src/runtime/app.ts` |
| Strict parser (path, content-type, JSON, **multipart**), CVE + fuzz test | `src/core/strict.ts`, `test/security/` |
| Auth bearer/cookie + CSRF, CORS | `src/auth.ts`, `src/runtime/{credentials,cors}.ts` |
| Adapter: fetch, Bun, Node (+ conformance test เทียบทุก adapter) | `src/{bun,node}.ts`, `test/conformance.test.ts` |
| CLI: `check`, `routes`, `build`, `diff`, manifest | `src/cli/*` |
| `pangol/register` (รัน .ts บน Node 22.18+) | `src/register.ts`, `src/cli/load.ts` |
| Benchmark เทียบ Hono/Elysia | `bench/` (ผลใน `bench/README.md`) |

**Release:** `release.yml` stage แพ็กเกจบน npm เมื่อ push tag `v*` แล้วเจ้าของกดอนุมัติด้วย 2FA (`npm stage approve`) ดูวิธีใน `release.yml`
(branch `ci/staged-publishing` ยังรอ merge ณ วันที่เขียน)

**ข้อจำกัดที่รู้แล้ว**
- Bun และ fetch normalize dot-segment ใน URL ก่อนถึงแอป (SPEC 3) มีแค่ Node adapter ที่ปฏิเสธได้ครบ
- Rate limit เก็บในหน่วยความจำ ใช้หลาย instance ไม่ได้
- `pangol diff` บน Bun กับ Node ได้ hash ของ function ต่างกัน (Bun แปลงโค้ดก่อน) ต้องเทียบบนรันไทม์เดียวกัน
- npm 12 ไม่อ่าน `publishConfig.tag`: publish ด้วยมือต้องใส่ `--tag alpha` เสมอ

## 2. วิธีทำงานที่ใช้มาตลอด (ทำต่อแบบเดียวกัน)

1. **Spec ก่อน:** พฤติกรรมใหม่เริ่มจากแก้ `SPEC.md`; การตัดสินใจลง `DECISIONS.md`; ข้อที่อยู่ใน "Open" ต้องถามก่อน
2. **TDD:** เขียนเทสต์ ดูมันล้ม แล้วค่อยเขียนโค้ด
3. **Mutation check:** กฎความปลอดภัยทุกข้อ ลองใส่บั๊กกลับเข้าไปทีละจุดแล้วต้องมีเทสต์ล้ม (สคริปต์แบบเดียวกับที่ใช้ใน commit ก่อนๆ: แทนข้อความในไฟล์ → รัน vitest → คืนไฟล์)
4. **ก่อน push รัน CI ในเครื่อง:** `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm test:bun`, `pnpm build`
5. **หนึ่ง branch + หนึ่ง Conventional Commit ต่อชิ้นงาน** commit body ละเอียด; `main` รับเฉพาะ PR
6. **Core ไม่มี runtime dependency** และไม่ทำงานต่อ request ที่ทำตอน start ได้; ถ้าขนาด bundle หรือ type instantiation เปลี่ยน ให้รายงาน (`pnpm typeperf`)
7. **Hot path:** ห้ามเขียน object literal ที่มี getter ต่อ request (ทำให้ V8 pretenure/deopt วนจน GC ทุก ~100 ms) ใช้ class แทน และห้ามสร้าง closure ต่อ request บนทาง sync ดู commit `perf:` และ `bench/README.md`

## 3. งานถัดไป (เรียงตามที่แนะนำ)

### 3.1 OpenAPI: `pangol openapi`

**ทำไมก่อน:** เล็ก ใช้ของที่มีอยู่ (`SchemaDef`, manifest) และเป็นฐานของ typed client (SPEC 11: "จาก JSON Schema ชุดเดียวกับ client")

**SPEC:** 11, 13

**แนวทาง**
- `src/cli/openapi.ts`: `SchemaDef` → JSON Schema (draft 2020-12, ที่ OpenAPI 3.1 ใช้) แล้วประกอบเป็น document จาก `check()` result (มี route ที่โหลดแล้วทั้งหมด)
- การแปลง: `string` → `{type: string, minLength, maxLength, pattern}`; `id` → string 1–200; `uuid` → `format: uuid` + pattern ตัวพิมพ์เล็ก; `email` → `format: email`, `maxLength`; `int` → `integer`; `money` → **`type: string`** + pattern ตาม `scale` + `x-pangol-money: { scale, currency }` (บนสายเป็น decimal string); `object` → `additionalProperties: false` เสมอ; `.optional()`/`.default()` → ไม่อยู่ใน `required` (+ `default`)
- `auth` → `securitySchemes` (bearer หรือ cookie ตาม `defineAuth`) และ `security` ต่อ operation; `'public'` = `security: []`; permission ใส่ใน `x-pangol-permission`
- Response: 200/201 ตาม handler ไม่รู้ล่วงหน้า → ใช้ 200 (และ 201 ถ้า handler อ่าน `created` ตาม AST จาก `analyze()`), `t.empty()` → 204; error ทุกตัวเป็น `{ error, field? }` ใส่ 400/401/403/404/413/415/429 ตามที่ route เป็นไปได้
- เพิ่ม `description` ของ route ลง operation

**ถามก่อนเริ่ม:** 201 vs 200 ให้อ่านจาก AST (`c.created`) หรือให้ประกาศ `status` ใน `route()`?

**เสร็จเมื่อ:** document ผ่าน validator ของ OpenAPI 3.1 (ใช้ตัวที่มีใน devDependencies หรือ schema ทางการ), snapshot test ของ fixture `good`, ทุก schema kind มีเทสต์การแปลง, e2e: `pangol openapi > openapi.json` ในโปรเจกต์ชั่วคราว

### 3.2 Typed client: `.pangol/api.d.ts` + `pangol/client`

**SPEC:** 11 · อ้างอิง PoC: `poc/rpc` (codegen + วัด autocomplete)

**แนวทาง**
- `pangol build` เขียนเพิ่ม `.pangol/api.d.ts`: interface แบน `Api` เป็น `{ 'GET /posts/:id': { params: {...}; query: {...}; body: never; response: {...} } }` สร้างเป็นข้อความ TypeScript จาก `SchemaDef` ไม่ infer จากโค้ด server (เหตุผลจาก PoC 1: IDE เร็ว)
- `src/client.ts` → export `pangol/client`: `createClient<Api>({ baseUrl, headers, fetch })` มี `get/post/put/patch/delete(path, { params, query, body })`; แทน `:id` ด้วย `encodeURIComponent`; non-2xx → `throw new ApiError(status, body)`; ไม่ใช้ Proxy
- ต้องไม่ import อะไรจากฝั่ง server (client ไปอยู่ใน browser bundle)

**ถามก่อนเริ่ม**
- `t.money` ฝั่ง client: ให้ type เป็น `string` ตามสาย (แนะนำ: ไม่บังคับ client ใช้ bigint) หรือแปลงเป็น `bigint` ให้อัตโนมัติ?
- `.pangol/` ถูก gitignore: แอป frontend ที่อยู่คนละ repo จะเอา `api.d.ts` ไปยังไง (publish เป็นแพ็กเกจ, copy, หรือ path ใน monorepo)?

**เสร็จเมื่อ:** type test (`exact<>` แบบใน `test/route.types.ts`) ว่า path/params/body/response ถูก และผิดแล้ว type error; runtime test ของ client กับ `app.fetch` จริง; วัด autocomplete/`tsc` ที่ 2,000 route ตาม SPEC 14 (≤ 500 ms / ≤ 2 s) ด้วยสคริปต์แบบ `scripts/type-performance.mjs`

### 3.3 `t.multipart` + `t.file`

**SPEC:** 6 (ตาราง primitive), 8 (Multipart, Upload)

**ของที่มีแล้ว:** `parseMultipart`, `boundaryOf`, `FilePart`, `MultipartLimits` ใน `src/core/strict.ts` พร้อม CVE test (Elysia CVE-2026-56669) และ fuzz test

**แนวทาง**
- `t.multipart({ title: t.string(), avatar: t.file({ maxSize: 2_000_000, types: ['image/png'] }) })` ใช้ได้เฉพาะ `body`; `Infer` ของ `t.file()` = `{ filename: string; type: string; data: Uint8Array }`
- Pipeline: ถ้า body เป็น multipart → ตรวจ `content-type` เป็น `multipart/form-data` (ไม่ใช่ = 415) → `readBody` ตาม limit → `parseMultipart` → validate ทีละ field (field ข้อความ = string และใช้ schema เดิม; field ซ้ำ = 400 ยกเว้นประกาศเป็น array)
- ชื่อไฟล์จาก client เป็นข้อมูลเท่านั้น ห้ามใช้เป็น path (SPEC 8)
- `startup check`: `t.multipart` บน GET/DELETE หรือใน query/params = error; `t.file` ใน response = error

**ถามก่อนเริ่ม:** SPEC ให้ตรวจชนิดไฟล์จาก magic bytes ใน v0.2 สำหรับ v0.1 ให้ `types` ตรวจจาก `Content-Type` ของ part (ที่ client ปลอมได้) หรือเลื่อน `types` ไป v0.2 แล้ว v0.1 มีแค่ `maxSize`? (แนะนำ: เลื่อน เพื่อไม่ให้มีกฎที่ดูเหมือนปลอดภัยแต่ไม่ใช่)

**เสร็จเมื่อ:** เทสต์ positive/negative ทุกกฎใน `test/security/`, conformance case ของ multipart ทั้ง 3 adapter, mutation check, ใส่ใน manifest (field path + kind `file`)

### 3.4 `pangol dev` / `pangol serve` (+ `defineConfig`)

**SPEC:** 4 (`pangol.config.ts`), 12 (`defineServices`), 13

**แนวทาง**
- `defineConfig({ runtime, basePath, cors, limits })` ใน `pangol.config.ts` และให้ `pangol build` สร้าง `.pangol/server.ts` ที่ประกอบ `createApp({ auth, routes, ...config })` + `serve()` ของรันไทม์ที่เลือก
- `pangol serve [port]`: รัน `.pangol/server.ts` (Bun ตรงๆ; Node ผ่าน `--import pangol/register`)
- `pangol dev`: `check` → spawn server เป็น child process → `fs.watch(src, { recursive: true })` → เมื่อไฟล์เปลี่ยน: debounce, `check` ใหม่, ถ้าผ่านค่อย restart child (ถ้าไม่ผ่าน แสดง error และคง server เดิมไว้) และ build route table ใหม่
- Graceful shutdown ตาม SPEC 12 (SIGTERM, รอ request ค้าง ≤ 25 s, `onShutdown`) อยู่ในงานนี้หรือแยก

**ถามก่อนเริ่ม**
- ผู้ใช้ส่วนใหญ่มี `src/server.ts` ของตัวเอง (เสียบเข้าแอปเดิมได้ตาม SPEC 12) ให้ `dev/serve` รัน entry ของผู้ใช้ หรือให้ framework generate server เอง หรือทั้งสองแบบ?
- `defineServices` (onStart/onShutdown) ทำใน v0.1 ไหม?

**เสร็จเมื่อ:** e2e แบบ `test/cli/e2e.test.ts`: dev รับ request → แก้ไฟล์ route → request ถัดไปเห็นของใหม่ → ใส่ route ผิดกฎ → server เดิมยังตอบและมี error แสดง; serve ตอบได้ทั้ง Node และ Bun

### 3.5 `npm create pangol`

**SPEC:** 13, 16 (AGENTS.md ในทุกโปรเจกต์ใหม่)

**แนวทาง**
- แพ็กเกจใหม่ `packages/create-pangol` (`npm create pangol` เรียกแพ็กเกจชื่อ `create-pangol`) ไม่มี dependency; copy template จากโฟลเดอร์ `template/`
- Template: `package.json` (scripts: `dev`, `check`, `build`, `test`), `tsconfig.json`, `src/auth.ts`, `src/models.ts`, `src/routes/health.get.ts`, `src/routes/posts/[id].get.ts` (ตัวอย่าง load+owner), เทสต์หนึ่งไฟล์, `AGENTS.md` (กฎ 1 ไฟล์ 1 route, กฎเจ้าของอยู่ใน `owner`, รัน `npm run check` หลังแก้ทุกครั้ง), `.gitignore` (`.pangol/`)
- ถามแค่ชื่อโฟลเดอร์และรันไทม์ (Bun / Node); ไม่ติดตั้งให้เองถ้าไม่ได้สั่ง

**ถามก่อนเริ่ม:** ต้องจองชื่อ `create-pangol` บน npm (เจ้าของทำเอง เหมือนตอน publish `pangol`) และ release ของสองแพ็กเกจนี้ผูก version กันไหม

**เสร็จเมื่อ:** CI สร้างโปรเจกต์จาก template แล้วรัน `check`, `test`, `build` ผ่านทั้ง Node และ Bun; ทุกตัวอย่างในเอกสารผ่าน `pangol check` (กฎใน CONTRIBUTING)

### 3.6 ปิดช่องว่าง benchmark บน Bun

**ตัวเลขตอนนี้ (`bench/README.md`):** GET 81% ของ Elysia (~90% เมื่อ Elysia ส่ง security header ชุดเดียวกัน), `/health` 80% ของ `Bun.serve` เปล่า, POST 97%

**สิ่งที่วัดแล้ว:** CPU ใน `handle()` ราว 0.5 µs ต่อ GET เป็นส่วนน้อย ที่เหลือคือ HTTP ของ Bun, สร้าง `Response` และ **การอ่าน `request.url` (~0.5 µs)** ที่ strict path check ต้องใช้ ส่วน Elysia route ผ่าน router ของ Bun เองจึงไม่อ่าน URL

**ทางที่ควรลอง (ตามลำดับ)**
1. **Bun native `routes`** (SPEC 3 เขียนไว้แล้วว่า Bun adapter ใช้ `Bun.serve` + native `routes`): ลงทะเบียน path ของทุก route กับ Bun แล้วรับ `req.params`; คำถามสำคัญคือยังต้องตรวจ request-target ดิบไหม ต้องทดสอบว่า router ของ Bun match path ที่ไม่ canonical (`/%68ealth`, `%2F`, ตัวพิมพ์เล็กของ hex) หรือเปล่า ถ้า match ต้องคง `validTarget(request.url)` ไว้ ซึ่งจะเสียส่วนที่ได้ไปเกือบหมด
2. Response ที่คงที่ (เช่น handler ที่คืนค่าเดิมทุกครั้ง) cache เป็น static response แบบที่ Elysia ทำ: ได้แค่ route แบบ `/health` ไม่ใช่งานจริง จึงลำดับท้าย
3. Serializer: string field ที่ไม่มีอักขระต้อง escape ให้เขียนตรงแทน `JSON.stringify` (วัดก่อนว่าคุ้ม)

**กฎ:** ทุกการเปลี่ยนต้องผ่าน conformance test (รวม test ใหม่สำหรับ path ที่ native router อาจรับ) และ CVE/fuzz test เดิม ห้ามแลกความเข้มงวดกับความเร็วโดยไม่ถาม; วัดด้วย `bench/` แบบ A/B ที่ server/wrk pin คนละ core

**ถามก่อนเริ่ม:** ถ้าเร็วขึ้นได้ด้วยการยอมให้ Bun normalize path มากขึ้น (เหมือนที่ยอมเรื่อง dot-segment ไปแล้ว) ยอมได้แค่ไหน?

## 4. ลำดับที่แนะนำ

1. OpenAPI → 2. Typed client (ใช้ JSON Schema/โครงเดียวกัน) → 3. `t.multipart` → 4. `dev`/`serve` + `defineConfig` → 5. `npm create pangol` (ต้องมี dev/serve ก่อน template จะสมบูรณ์) → 6. Bun benchmark (ทำขนานได้ทุกเมื่อ)

แต่ละข้อเป็น branch และ PR ของตัวเอง; ปิดท้ายด้วย `0.1.0-alpha.N` ผ่าน `release.yml`

## 5. คำถามที่ยังเปิดจาก DECISIONS.md

- Idempotency: อยู่ใน core (`idempotent: true`) หรือ plugin, เก็บ key ที่ไหน นานเท่าไร
- เปลี่ยน owner failure เป็น 403 ราย route ได้ไหม
- Domain (`pangol.dev`?) และเครื่องหมายการค้า
