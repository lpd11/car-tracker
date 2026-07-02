# Car Tracker — CLAUDE.md

## โปรเจคคืออะไร

แอปบันทึกค่าใช้จ่ายรถยนต์ 2 คันในครอบครัว ผ่าน **LINE LIFF** โดยใช้ **Google Apps Script + Google Sheets** เป็น backend และ **GitHub Pages** เป็น frontend hosting

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
| Platform | LINE LIFF (3 LIFF IDs แยกต่างหาก) |
| Hosting | GitHub Pages (`https://eliang1111.github.io/car-tracker/`) |
| Deploy tool | clasp (scriptId: `1MDVQFzjLE068BxzGoYrINAWlzsXBkTl6BLd_5NfxbADR8pJuMQzfdn09`) |

---

## โครงสร้างไฟล์

```
Code.gs              — Apps Script backend (doGet/doPost API)
appsscript.json      — Apps Script config (timezone: Asia/Bangkok)
home.html            — หน้า landing / navigation สำหรับเทสบน PC (ไม่ใช้ LIFF)
fuel.html            — หน้าบันทึกเติมน้ำมัน
maintenance.html     — หน้าบันทึกซ่อมบำรุง
history.html         — หน้าประวัติ + Dashboard + รายงาน
js/app.js            — Shared utilities, LIFF init, car toggle, format helpers
js/api.js            — API bridge (live mode + mock localStorage mode + client cache)
css/style.css        — Shared styles
manifest.json        — PWA manifest (ชื่อแอป, icon, สี, start_url)
sw.js                — Service Worker (network-first caching สำหรับ PWA)
favicon.png          — App icon (ไม่มีขอบขาว, ใช้เป็น browser tab icon)
icon-192.png         — PWA icon 192×192 (Android home screen)
icon-512.png         — PWA icon 512×512 (Android splash screen)
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
- [x] รายงานรายเดือน/รายปี พร้อมส่งเข้าแชท LINE (Flex Message)
- [x] **Client-side cache** ใน `api.js` — TTL 2 นาที, stale-while-revalidate pattern (แก้ปัญหาโหลดช้า 5 วินาที)
- [x] **Optimistic delete** — ลบรายการจาก UI ทันทีโดยไม่ต้อง reload ทั้งหน้า
- [x] แก้ bug LINE Flex Message: `rgba()` → hex (`#FFFFFF1A`) ที่ทำให้ส่งรายงานไม่ได้
- [x] ตั้งค่า GitHub repo และ GitHub Pages hosting
- [x] เพิ่ม scope `chat_message.write` ใน LINE Developer Console (ทำโดย user)
- [x] **home.html** — หน้า navigation landing สำหรับเทสบน PC: เลือกรถ + 3 nav cards ลิงก์ไปแต่ละหน้า
- [x] Import ข้อมูลประวัติจาก Drivvo CSV (33 fuel records + 7 maintenance visits สำหรับ Nissan Almera)
- [x] แสดงราคา/ลิตร ในหัวการ์ดประวัติเติมน้ำมัน เช่น `เติมน้ำมัน - E20 (35.5 บ./ลิตร)`
- [x] ช่องปั๊มน้ำมันใน `fuel.html` แยกเป็น dropdown แบรนด์ (ปตท./บางจาก/PT/Shell/Caltex/อื่นๆ) + text สาขา
- [x] ลบ เอสโซ่ ออกจาก dropdown (ไม่มีปั๊มเอสโซ่ในไทยแล้ว — บางจากซื้อกิจการปี 2017)
- [x] **PWA support** — `manifest.json` + `sw.js` + icons ให้ install เป็นแอปบน Android ได้ (Add to Home Screen)
- [x] **Favicon** — CARRR logo (พื้นดำ ไม่มีขอบขาว) แสดงบน browser tab ทุกหน้า
- [x] **ปุ่ม Home** — ทุกหน้า (fuel/maintenance/history) มีปุ่ม 🏠 มุมขวาบน header กดกลับ home.html

---

## สิ่งที่ยังต้องทำ / Known Issues

- [ ] **CARS hardcode ซ้ำ 2 ที่** — `js/app.js` และ `Code.gs` ถ้าเพิ่มรถใหม่ต้องแก้ทั้ง 2 ที่ (ควรดึงจาก Sheets แทน)
- [ ] **ไม่มี error retry** — ถ้า network กระตุกต้อง refresh หน้าเอง
- [ ] **`alert()` / `confirm()` เป็น browser native** — ใน LINE LIFF บางรุ่นอาจ block หรือ UI ไม่สวย ควรเปลี่ยนเป็น custom modal
- [ ] **cache invalidation ข้ามหน้า** — ตอนนี้ cache clear อัตโนมัติเมื่อ navigate กลับมาหน้า history (เพราะ page reload) แต่ยังไม่มี explicit invalidate หลังจาก save fuel/maintenance

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

## LIFF IDs

| หน้า | LIFF ID |
|---|---|
| fuel.html | `2010486446-X0yj8FUH` |
| maintenance.html | `2010486446-vdtoyrHt` |
| history.html | `2010486446-QZGGJYTL` |

> LIFF app ทั้ง 3 ต้องมี scope: `profile`, `chat_message.write` (history เท่านั้นที่ใช้ sendMessages)
