# Car Tracker — CLAUDE.md

## โปรเจคคืออะไร

แอปบันทึกค่าใช้จ่ายรถยนต์ 2 คันในครอบครัว เป็น **PWA (Web App เต็มตัว)** — เพิ่มไปหน้าจอหลักบนมือถือได้ทั้ง Android/iPhone โดยใช้ **Google Apps Script + Google Sheets** เป็น backend และ **GitHub Pages** เป็น frontend hosting

> เดิมทีเป็น LINE LIFF — **ถอด LIFF ออกทั้งหมดแล้ว** (3 ก.ค. 2026) เปลี่ยนเป็น web app + ระบบโปรไฟล์ในเครื่องแทน — รายละเอียดดู [Changelog ก.ค. 2026](#changelog-3-ก.ค.-2026)

รถที่ติดตาม:
- Nissan Almera 2020 (ส้ม) ทะเบียน 9กข 70
- Honda Jazz 2014 (เหลือง) ทะเบียน 3กส 7666

---

## Stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | HTML/CSS/JS (ไม่มี framework) + FontAwesome + Chart.js |
| Backend | Google Apps Script (Web App) — `Code.gs` |
| Database | Google Sheets (5 sheets) |
| Platform | PWA (installable web app) — ไม่มี LINE LIFF แล้ว |
| Auth | Profile switcher ในเครื่อง (Liang / Koy) เก็บใน localStorage — ไม่มี login จริง |
| Hosting | GitHub Pages (`https://lpd11.github.io/car-tracker/`) |
| Deploy tool | clasp (scriptId: `1MDVQFzjLE068BxzGoYrINAWlzsXBkTl6BLd_5NfxbADR8pJuMQzfdn09`) |

---

## โครงสร้างไฟล์

```
Code.gs              — Apps Script backend (doGet/doPost API)
appsscript.json      — Apps Script config (timezone: Asia/Bangkok)
home.html            — หน้าหลักจริงของแอป: ทักทายชื่อโปรไฟล์ + 3 เมนู (mobile-first, ไม่มี car selector)
fuel.html            — หน้าบันทึกเติมน้ำมัน
maintenance.html     — หน้าบันทึกซ่อมบำรุง
history.html         — หน้าประวัติ + Dashboard + รายงาน (ดูในแอป ไม่มีส่งเข้า LINE แล้ว)
js/app.js            — Shared utilities, profile picker/switcher, car toggle, format helpers
js/api.js            — API bridge (live mode + mock localStorage mode + client cache)
css/style.css        — Shared styles
manifest.json        — PWA manifest (ชื่อแอป, icon, สี, start_url)
sw.js                — Service Worker (network-first caching สำหรับ PWA)
favicon.png          — App icon (ไม่มีขอบขาว, ใช้เป็น browser tab icon)
icon-192.png         — PWA icon 192×192 (Android home screen)
icon-512.png         — PWA icon 512×512 (Android splash screen)
Files/M.png          — รูปโปรไฟล์ Liang (silhouette ชาย สีน้ำเงิน, 256×256 พื้นโปร่งใส)
Files/FM.png         — รูปโปรไฟล์ Koy (silhouette หญิงผมยาว สีชมพู, 256×256 พื้นโปร่งใส)
```

## Google Sheets Schema

| Sheet | Columns หลัก |
|---|---|
| `fuel_records` | record_id, car_id, date, odometer_km, fuel_type, liters, price_per_liter, total_cost, station, efficiency_km_per_liter |
| `maintenance_records` | record_id, car_id, date, time, odometer_km, shop_name, total_cost, next_km, next_date, notes |
| `maintenance_items` | item_id, record_id, service_name, cost |
| `service_types` | service_name, is_active (soft delete) |
| `cars` | car_id, car_name, year, color, license_plate |

---

## สิ่งที่ทำเสร็จแล้ว

- [x] Backend API ครบทุก CRUD (fuel, maintenance, service types)
- [x] คำนวณ fuel efficiency (km/L) อัตโนมัติเมื่อบันทึกเติมน้ำมัน
- [x] Mock mode (LocalStorage) สำหรับ test โดยไม่ต้องต่อ API จริง
- [x] หน้า history: Dashboard สรุปรายเดือน + กราฟ 6 เดือน + ค้นหา/กรอง
- [x] รายงานรายเดือน/รายปี + **แท็บสรุปน้ำมัน** (ค่าใช้จ่ายรวม, จำนวนครั้ง, ลิตรรวม, ราคาเฉลี่ย/ลิตร, กม./ลิตรเฉลี่ย, รายการเติมทั้งเดือน)
- [x] **เลือกรถได้ในหน้ารายงาน** — ไม่ต้องปิด panel ออกไปสลับที่ header
- [x] **Optimistic delete** — ลบรายการจาก UI ทันทีโดยไม่ต้อง reload ทั้งหน้า
- [x] แก้ bug LINE Flex Message: `rgba()` → hex (`#FFFFFF1A`) ที่ทำให้ส่งรายงานไม่ได้
- [x] ตั้งค่า GitHub repo และ GitHub Pages hosting
- [x] เพิ่ม scope `chat_message.write` ใน LINE Developer Console (ทำโดย user)
- [x] Import ข้อมูลประวัติจาก Drivvo CSV (33 fuel records + 7 maintenance visits สำหรับ Nissan Almera)
- [x] แสดงราคา/ลิตร ในหัวการ์ดประวัติเติมน้ำมัน เช่น `เติมน้ำมัน - E20 (35.5 บ./ลิตร)`
- [x] ช่องปั๊มน้ำมันใน `fuel.html` แยกเป็น dropdown แบรนด์ (ปตท./บางจาก/PT/Shell/Caltex/อื่นๆ) + text สาขา
- [x] ลบ เอสโซ่ ออกจาก dropdown (ไม่มีปั๊มเอสโซ่ในไทยแล้ว — บางจากซื้อกิจการปี 2017)
- [x] **PWA support** — `manifest.json` + `sw.js` + icons ให้ install เป็นแอปบน Android/iPhone ได้ (Add to Home Screen), meta tags `apple-mobile-web-app-capable` ทุกหน้า
- [x] **Favicon** — CARRR logo (พื้นดำ ไม่มีขอบขาว) แสดงบน browser tab ทุกหน้า
- [x] **ปุ่ม Home** — ทุกหน้า (fuel/maintenance/history) มีปุ่ม 🏠 มุมขวาบน header กดกลับ home.html
- [x] **ถอด LINE LIFF ออกทั้งหมด** — เปลี่ยนเป็น PWA web app เต็มตัว (ดูรายละเอียดใน Changelog ด้านล่าง)
- [x] **ระบบโปรไฟล์ Liang/Koy** แทน LINE login (ดูหัวข้อ "ระบบโปรไฟล์")
- [x] **หน้าหลักใหม่ mobile-first** — ทักทายชื่อโปรไฟล์, ไม่มี car selector (ย้ายไปหน้ารายงาน/แต่ละเมนูแทน)
- [x] **จำรถล่าสุดแยกตามคน** — Liang กับ Koy จำรถคนละคัน
- [x] **Persistent cache (stale-while-revalidate)** ใน `api.js` — เก็บใน localStorage (ไม่ใช่ in-memory) โชว์ข้อมูลเก่าทันทีตอนเปิดหน้า history แล้ว refresh เบื้องหลังถ้าเกิน TTL 2 นาที แก้ปัญหาโหลดช้าจาก Apps Script cold start (~10-20 วิ)
- [x] **รูปโปรไฟล์เป็นภาพจริง** — `Files/M.png` / `Files/FM.png` แทน SVG icon เดิม

---

## สิ่งที่ยังต้องทำ / Known Issues

- [ ] **CARS hardcode ซ้ำ 2 ที่** — `js/app.js` และ `Code.gs` ถ้าเพิ่มรถใหม่ต้องแก้ทั้ง 2 ที่ (ควรดึงจาก Sheets แทน)
- [ ] **ไม่มี error retry** — ถ้า network กระตุกต้อง refresh หน้าเอง
- [ ] **`alert()` / `confirm()` เป็น browser native** — UI ไม่สวย ควรเปลี่ยนเป็น custom modal
- [ ] **Apps Script cold start ~10-20 วิ** — เกิดตอนเปิดแอปครั้งแรกของวัน (container ของ Google ถูกปิดตอนไม่มีคนใช้) persistent cache ช่วยลดผลกระทบตอนเปิดครั้งถัดๆ ไปแล้ว แต่ครั้งแรกสุดยังช้าอยู่ — ถ้าอยากแก้ที่ต้นตอต้องทำ keep-warm (ยิง ping ทุก 5-10 นาที) หรือย้ายออกจาก Apps Script ไปใช้ BaaS ที่ไม่มี cold start (เช่น Supabase/Firebase — พิจารณาแล้วว่ายังไม่คุ้มสำหรับตอนนี้ ดู Changelog)

---

## วิธี Deploy

**Frontend (GitHub Pages):**
```bash
git add .
git commit -m "..."
git push origin main
# GitHub Pages deploy อัตโนมัติ ใช้เวลา ~1-2 นาที
```

**Backend (Apps Script):**
```bash
clasp push   # อัพโหลด Code.gs ขึ้น Apps Script
# จากนั้น Deploy ใหม่ใน Apps Script console ถ้าแก้ Code.gs
```

---

## ระบบโปรไฟล์ (แทน LINE login)

- โปรไฟล์กำหนดไว้ล่วงหน้าใน `js/app.js` → `PROFILES`: **Liang** (รูป `Files/M.png`) และ **Koy** (รูป `Files/FM.png`)
- เปิดแอปครั้งแรก → หน้าเลือกโปรไฟล์ (full-screen overlay, สร้างโดย `renderProfilePicker()`) — จำไว้ถามครั้งเดียว
- แตะ badge/chip ที่ header หรือหน้า home → `switchProfile()` เปลี่ยนคน (แล้ว `location.reload()`)
- `user_name` ที่บันทึกลง Sheets = ชื่อโปรไฟล์ที่เลือก (`currentUser.displayName`)
- `profileAvatarHTML(profile)` คืน `<img>` tag — ใช้ร่วมกัน 3 จุด: หน้าเลือกโปรไฟล์, chip หน้า home, badge บน header ของทุกหน้า
- ไม่มี auth จริง — เป็นแค่ตัวเลือกจำใน localStorage เพื่อแยกชื่อผู้บันทึก/รถล่าสุด ไม่ได้กันคนนอกเข้าเว็บ (ตามที่ตกลงไว้ว่าไม่ต้องกัน)

### localStorage keys

| key | ความหมาย |
|---|---|
| `car_tracker_profile` | โปรไฟล์ปัจจุบัน (`liang` / `koy`) |
| `car_tracker_active_car_liang` | รถล่าสุดของ Liang (1 / 2) |
| `car_tracker_active_car_koy` | รถล่าสุดของ Koy (1 / 2) |
| `car_tracker_history_cache_<carId>` | persistent cache ข้อมูลหน้า history ต่อรถ (ดูหัวข้อ cache ด้านล่าง) |

> **จำรถล่าสุดแยกตามคน** — ผ่าน helper `activeCarStorageKey()` ใน `app.js` เข้าเมนูไหนก็เด้งรถคันล่าสุดของคนนั้นให้ (ครั้งแรกสุด default = Nissan Almera / id 1) ในหน้ารายงานก็เลือกรถเปลี่ยนได้เช่นกัน (ไม่ต้องปิด panel ออกไปที่ header)

> LIFF apps เดิม 3 ตัวใน LINE Developer Console ไม่ได้ใช้แล้ว (ปล่อยทิ้งไว้ได้ ไม่กระทบ)

---

## Persistent Cache (stale-while-revalidate)

- เดิม cache เป็น in-memory object → หายทุกครั้งที่ปิด/reload หน้า ทำให้เจอ Apps Script cold start (~10-20 วิ) ซ้ำๆ
- ตอนนี้ย้ายไป **localStorage** แยก key ตามรถ (`car_tracker_history_cache_<carId>`) ใน `js/api.js`: `getHistoryCache()`, `setHistoryCache()`, `isHistoryCacheFresh()`, `invalidateHistoryCache()`
- Flow ในหน้า history (`loadAllHistoryData()`):
  1. มี cache (ไม่ว่าเก่าแค่ไหน) → โชว์ทันที (0 วินาที)
  2. ถ้า cache เก่าเกิน TTL (2 นาที) → ดึงข้อมูลใหม่เบื้องหลัง พร้อมแถบ "กำลังอัปเดตข้อมูล…" (`showRefreshIndicator()`) ไม่บล็อกหน้าจอ
  3. ไม่มี cache เลย (เปิดครั้งแรกสุด) → รอ network พร้อม spinner เต็มจอเหมือนเดิม
- **ต้อง invalidate cache หลังบันทึกข้อมูลใหม่เสมอ** — เรียก `invalidateHistoryCache(activeCar.id)` ใน `fuel.html`/`maintenance.html` หลัง save/update สำเร็จ ไม่งั้นหน้า history จะโชว์ข้อมูลเก่าที่ยังไม่มีรายการที่เพิ่งเซฟ
- ⚠️ จุดที่เคยพลาด: ใน `applyHistoryData()` ต้อง set `fuelRecords`/`maintenanceRecords` **ก่อน** เรียก `drawChart()` เสมอ เพราะถ้า chart render พังกลางคัน ข้อมูลจะไม่อัปเดต (เจอบั๊กนี้ตอนสลับรถในหน้ารายงานแล้วข้อมูลค้าง)

---

## Changelog (3 ก.ค. 2026)

Session เดียวปรับใหญ่จาก LINE LIFF → PWA web app เต็มตัว:

1. ถอด LIFF SDK ออกทุกหน้า, ตัดฟีเจอร์ส่งรายงานเข้าแชท LINE (Flex Message) ทิ้ง — ดูรายงานในแอปอย่างเดียว
2. เพิ่มระบบโปรไฟล์ Liang/Koy (เลือกครั้งเดียวจำไว้ในเครื่อง, จำรถล่าสุดแยกตามคน)
3. รื้อหน้าหลัก (`home.html`) ใหม่ mobile-first — เอา car selector ออก, ทักทายชื่อโปรไฟล์
4. เพิ่มแท็บ "สรุปน้ำมัน" ในหน้ารายงาน + เลือกรถได้ในหน้ารายงานโดยไม่ต้องปิด panel
5. ย้าย cache จาก in-memory → localStorage (persistent, stale-while-revalidate) แก้ปัญหาโหลดช้าจาก Apps Script cold start
6. เปลี่ยนรูปโปรไฟล์จาก SVG icon เป็นภาพจริงที่ user เตรียม (`Files/M.png`, `Files/FM.png`)
7. เพิ่ม PWA meta tags (`apple-mobile-web-app-capable` ฯลฯ) ให้ install ได้ดีขึ้นบน iPhone
8. พิจารณาย้าย backend ไป Supabase/Firebase (เร็วกว่า ไม่มี cold start) แต่ตัดสินใจไม่ย้าย — เก็บ Google Sheets + Apps Script ไว้เหมือนเดิม เพราะ persistent cache ช่วยพอแล้วสำหรับการใช้งานจริง (ครอบครัว 2 คน, ใช้ไม่บ่อย) และไม่อยากแลกกับการเปิด data สาธารณะ (ไม่มี auth) ที่มากับ BaaS แบบเรียกตรงจาก client
9. Deploy ขึ้น GitHub Pages สำเร็จ (มี deploy รอบแรกล้มแบบ transient "Deployment failed, try again later" — re-trigger ด้วย empty commit แล้วผ่าน ไม่ใช่ปัญหาโค้ด)
