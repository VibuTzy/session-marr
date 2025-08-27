````markdown
name=README.md
```markdown
# session-marr

Repo ini menyediakan API Next.js untuk membuat session/paired credentials (Baileys).

Quickstart:
1. Install deps:
   ```
   npm install
   ```
2. Development:
   ```
   npm run dev
   ```
3. Build:
   ```
   npm run build
   ```

Endpoint:
- GET /api/auth?phone=62...  -> memulai proses pairing, logs menampilkan QR/pairing code, response akan mengunduh sessions.zip bila berhasil.

Notes:
- Vercel ephemeral /tmp — gunakan storage eksternal kalau ingin menyimpan session permanen.
- Pastikan Node >= 18 di settings Vercel.
```
````