# pangol + Keycloak + PostgreSQL

ตัวอย่าง backend ที่คัดลอกไปเริ่มแอปได้: login ผ่าน Keycloak, ตรวจ bearer access token, map ผู้ใช้ลง PostgreSQL และ CRUD posts ที่แต่ละคนเห็นเฉพาะข้อมูลตัวเอง **ไม่มีการเปลี่ยน core ของ pangol และยังไม่มี HTML/HTMX response**

ตัวอย่างใช้ Node 22.18+; Docker Compose ใช้เฉพาะบริการทดลอง ไม่ต้องใช้ Keycloak ขององค์กรหรือ ThaiD จริงเพื่อรันเทสต์ หาก ThaiD เชื่อมกับ Keycloak ของคุณอยู่แล้ว backend จะตรวจ token ที่ Keycloak ออกให้ ไม่ต้องเชื่อม ThaiD ซ้ำ

## ลองจาก repo นี้

ต้องมี Node 22.18+, pnpm ตาม `packageManager` ของ repo และ Docker Compose v2 พอร์ต 3000, 8080, 8787 และ 55432 ต้องว่าง

จาก root ของ repo:

```sh
pnpm install --frozen-lockfile
pnpm --filter pangol build
cd examples/keycloak-postgres
cp .env.example .env
```

เปิด Keycloak/PostgreSQL และรอ realm import เสร็จ:

```sh
docker compose up -d
node scripts/wait-for-keycloak.mjs
npm run migrate
npm run build
npm start
```

API ฟังที่ `http://127.0.0.1:3000` และ `GET /health` ตอบ `{ "ok": true }` การเริ่ม server จะตรวจว่า DB และตารางผู้ใช้พร้อมก่อนเปิด port; health เป็น **liveness** ไม่ได้ตรวจ DB ทุก request

เปิด terminal อีกอันที่ `examples/keycloak-postgres`:

```sh
npm run login
```

เปิด URL ที่คำสั่งแสดง แล้ว login ด้วย `alice` / `demo-local-only` (หรือ `bob` / `demo-local-only`) คำสั่งนี้ใช้ Authorization Code + PKCE S256 และตรวจ state รับ callback ที่ `127.0.0.1:8787/callback` แล้วเก็บ **access token เท่านั้น** ใน `.local/token.json` ด้วยสิทธิ์ 0600 ไม่พิมพ์ token ใน terminal ไม่เก็บ refresh token หากหมดอายุให้ login ใหม่

ลอง API โดยไม่ต้องคัดลอก token ลง shell history:

```sh
node scripts/api.mjs GET /me
node scripts/api.mjs POST /posts '{"title":"My first post"}'
node scripts/api.mjs GET /posts
```

นำ `id` จากผลสร้าง post มาแทน `POST_ID`:

```sh
node scripts/api.mjs GET /posts/POST_ID
node scripts/api.mjs PATCH /posts/POST_ID '{"title":"Updated"}'
```

รัน `npm run login` อีกครั้งแล้วใช้ `bob`: รายการจะว่าง และการอ่าน/แก้/ลบ post ของ Alice จะได้ 404 เช่นเดียวกับ ID ที่ไม่มีอยู่ จากนั้น login กลับเป็น Alice เพื่อลบ:

```sh
node scripts/api.mjs DELETE /posts/POST_ID
```

ตัวอย่างไม่มี auto-watch: เมื่อแก้ source ให้หยุด server แล้วรัน `npm run build` และ `npm start` ใหม่ โดยเฉพาะเมื่อเพิ่มหรือลบ route

เมื่อทดลองเสร็จ หยุด API ด้วย Ctrl+C และหยุดบริการจากโฟลเดอร์นี้:

```sh
docker compose down -v
```

**ข้อมูล demo ไม่รับประกันการคงอยู่:** Compose นี้ไม่มี named volume สำหรับเก็บข้อมูลถาวร และ `down -v` ลบ volume ของ demo ด้วย อย่าใช้เก็บข้อมูลจริง

## API และสิ่งที่แต่ละชั้นรับผิดชอบ

| Route | Auth | ผลลัพธ์ |
|---|---|---|
| `GET /health` | public | process ตอบสนอง |
| `GET /me` | user | local user ID และ permissions |
| `GET /posts` | user | เฉพาะของผู้ใช้ปัจจุบัน สูงสุด 100 รายการ |
| `POST /posts` | `posts:write` | สร้าง post + event ใน transaction, 201 |
| `GET /posts/:id` | user + owner | post ของตนเอง |
| `PATCH /posts/:id` | `posts:write` + owner | แก้ title |
| `DELETE /posts/:id` | `posts:write` + owner | ลบ, 204 |

- [`src/token.ts`](src/token.ts): ตรวจลายเซ็น RS256 จาก JWKS ของ issuer ที่ตั้งไว้, issuer, audience, exp, iat, sub และชนิด access token ของ Keycloak (`typ: Bearer`) ปฏิเสธ ID token; รับ `posts:write` จาก `resource_access[pangol-api].roles` เท่านั้น ไม่รวม realm role หรือ role ของ client อื่น
- [`src/auth.ts`](src/auth.ts): ใช้ `defineAuth.resolve` เชื่อมผลตรวจ token กับ local user; token ผิด/ขาด = 401, permission ขาด = 403
- [`src/db.ts`](src/db.ts): identity คือคู่ `(issuer, subject)` ไม่ใช้ email/username เป็นกุญแจ; ผู้ใช้เดิมใช้ SELECT โดยไม่เขียนแถวซ้ำ ผู้ใช้ใหม่ใช้ INSERT ON CONFLICT DO NOTHING และอ่าน ID ของ request ที่สร้างสำเร็จเมื่อเกิดการชนกัน ใช้ parameterized SQL, list กรอง owner และ UPDATE/DELETE มี owner predicate ซ้ำเพื่อไม่ให้การเขียนอาศัยแค่ผล load ก่อนหน้า
- [`src/routes`](src/routes): route ประกาศ schema/auth/owner อย่างชัดเจน; ownership ล้ม = 404; client เปลี่ยน owner ผ่าน body ไม่ได้
- [`src/models.ts`](src/models.ts): `internalNote` เป็น private และ response ใช้ `Post.public()` ฟิลด์นี้จึงไม่ออกจาก API
- [`scripts/migrate.ts`](scripts/migrate.ts): migration รุ่น 001 รันใน transaction และ advisory lock เรียกซ้ำได้; แยก migration ออกจากการเริ่ม server ไม่ใช่ migration framework เต็มรูปแบบ
- [`src/server.ts`](src/server.ts): ตัวอย่าง app-owned SIGTERM/SIGINT handling หยุดรับงานใหม่ รอ connection แล้วปิด pool; มี deadline 25 วินาที ซึ่งถ้าเกินจะบังคับออก

การตรวจ JWT เป็นแบบ offline: JWKS มี cache และ refresh เมื่อพบ key ใหม่หลัง cooldown (ค่าเริ่มต้น 30 วินาที) การ logout/disable user ที่ provider **ไม่ได้เพิกถอน access token ที่ออกไปแล้วทันที** การใช้งานจริงต้องกำหนดอายุ token และนโยบาย revocation/introspection ตามระบบของคุณ

## เปลี่ยนไปใช้ Keycloak ที่มีอยู่แล้ว

อย่า import realm demo ทับ realm ขององค์กร ให้ตั้ง `.env` ตามค่าจริง:

```dotenv
DATABASE_URL=postgres://APP_USER:APP_PASSWORD@DB_HOST:5432/APP_DB
KEYCLOAK_ISSUER=https://sso.example.org/realms/YOUR_REALM
KEYCLOAK_AUDIENCE=pangol-api
KEYCLOAK_CLIENT_ID=pangol-cli
```

1. สร้าง API client `pangol-api` และ client role `posts:write` (หรือแก้ชื่อใน config และตัว verifier ให้ตรงกับของคุณ)
2. สร้าง public client สำหรับ loopback CLI demo เปิด Standard Flow และบังคับ PKCE S256; redirect URI ต้องเป็น `http://127.0.0.1:8787/callback` แบบตรงตัว ปิด Direct Access Grants และ Implicit Flow
3. เพิ่ม audience mapper ให้ access token มี `aud` รวม `pangol-api` และให้ client scope ออก role ของ API ตามสิทธิ์จริง; ดูตัวอย่างใน [`keycloak/pangol-demo-realm.json`](keycloak/pangol-demo-realm.json)
4. ให้ role เฉพาะผู้ใช้ที่ควรเขียนข้อมูลได้ ผู้ไม่มี role ยังอ่านข้อมูลของตัวเองได้ แต่สร้าง/แก้/ลบไม่ได้
5. ทดสอบด้วยผู้ใช้สองคน รวมกรณี token หมดอายุ, audience ผิด และการหมุน signing key ก่อนใช้ข้อมูลจริง

ใช้ HTTPS และกำหนด TLS ของ PostgreSQL ตามระบบจริงโดยไม่ปิด certificate validation; loopback HTTP ที่อนุญาตใน verifier มีไว้สำหรับ demo เท่านั้น หากเพิ่ม React ภายหลัง ให้ใช้ public browser client ของมันเองพร้อม Authorization Code + PKCE, redirect URI และ CORS origin ที่เจาะจง ส่ง access token เรียก API; CLI login นี้ไม่ใช่ session manager สำหรับ browser และไม่ได้เลือกวิธีเก็บ token ให้ frontend

## ทดสอบ

Unit tests ไม่ต้องเปิด Docker:

```sh
npm test
```

Integration tests ต้องมี Compose ที่เปิดไว้ และใช้ **ฐานข้อมูลสำหรับทดสอบเท่านั้น**:

```sh
TEST_DATABASE_URL=postgres://demo:demo-local-only@127.0.0.1:55432/pangol_demo npm run test:integration
```

การทดสอบสร้าง schema ชั่วคราวใน DB แล้วลบทิ้ง ไม่ truncate ตารางแอป; ต้องมีสิทธิ์ CREATE SCHEMA ใช้ realm `pangol-test` และ service accounts เฉพาะ fixture สำหรับตรวจสิทธิ์ รวมทั้งจำลอง browser form login กับ realm `pangol-demo` เพื่อทดสอบ helper PKCE จริง ห้ามนำ client secret/บัญชี demo ไปใช้กับระบบจริง

ครอบคลุม signature/issuer/audience/expiry/token kind, key rotation, identity lookup แบบไม่เขียนซ้ำและ first login พร้อมกัน 32 requests, role isolation, HTTP CRUD, owner/non-owner/missing-resource, list isolation, private-field filtering, mass assignment, SQL injection input, transaction rollback และ token file permissions เทสต์ไม่ข้ามหรือใช้ mock DB/provider ถ้าบริการจริงไม่พร้อม

CI ของ repo รัน `pangol check` ผ่าน build ของตัวอย่าง และมี job `keycloak-postgres` เปิดบริการจริงเพื่อรัน integration tests; Unit JWT tests ใช้ JWKS server ในเครื่องและกุญแจที่สร้างใหม่

## คัดลอกออกไปเป็นโปรเจกต์ของคุณ

คัดลอกโฟลเดอร์นี้โดยไม่รวม `.env`, `.local`, `node_modules` และ `.pangol` จากนั้นในโฟลเดอร์ใหม่:

```sh
npm pkg set name=my-backend 'dependencies.pangol=0.1.0-alpha.0'
npm install
cp .env.example .env
```

ใน repo ใช้ `workspace:*` เพื่อทดสอบกับ source ปัจจุบัน; โฟลเดอร์ที่แยกออกมาต้องเปลี่ยนเป็นรุ่น npm ที่ทดสอบแล้วตามคำสั่งข้างบน commit lockfile ของโปรเจกต์ใหม่ด้วย จากนั้นทำตามขั้นตอน Compose → migrate → build → start → login

## ขอบเขตตัวอย่าง

เป็น app-owned integration ไม่ใช่ Keycloak plugin API ของ core และไม่ใช่ระบบพร้อม deploy ทุกกรณี: ไม่มี tenant model, pagination เกิน 100 รายการ, distributed rate limiter, readiness endpoint, monitoring, refresh/session management หรือ frontend; ตาราง event สาธิต atomic write ไม่ใช่ immutable audit log การรันหลัง proxy, การ scale หลาย instance, TLS, backups และ secrets ต้องตั้งให้เหมาะกับระบบจริง

## เอกสารอ้างอิง

- [Keycloak Docker development setup](https://www.keycloak.org/getting-started/getting-started-docker)
- [Keycloak browser adapter และ PKCE](https://www.keycloak.org/securing-apps/javascript-adapter)
- [jose JWT verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) และ [remote JWKS](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md)
- [node-postgres parameterized queries](https://node-postgres.com/features/queries) และ [transactions บน client เดียวกัน](https://node-postgres.com/features/transactions)
