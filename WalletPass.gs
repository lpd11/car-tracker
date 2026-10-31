/**
 * WalletPass.gs — ระบบบัตรประจำรถยนต์ใน Google Wallet (Generic Pass) สำหรับ Car Tracker
 * - รองรับรถ 2 คัน: Car 1 (Nissan Almera 9กข 70 สีส้ม) และ Car 2 (Honda Jazz 3กส 7666 สีเหลือง)
 * - คำนวณรอบอะไหล่แบบ Smart Matching + Snap-to-Standard-Slot (ก่อนไม่เกิน 15% / ช้าไม่เกิน 20%)
 * - รองรับการกดเลื่อนเตือน (Snooze 3 / 7 / 10 วัน / กำหนดเอง) และตั้งค่าวันหมดอายุภาษี/ประกันจากลิงก์หลังบัตร
 */

const CAR_WALLET_API_BASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
const CAR_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const CAR_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAR_DEFAULT_ISSUER_ID = '3388000000023216943';
const CAR_APP_BASE_URL = 'https://lpd11.github.io/car-tracker';

const CAR_META = {
  '1': {
    id: '1',
    name: 'Nissan Almera 2020',
    plate: '9กข 70',
    hexColor: '#EA580C',
    iconUrl: CAR_APP_BASE_URL + '/Files/icon-almera.png',
    oilIntervalKm: 7000,
    airFilterIntervalKm: 35000,
    tireRotateIntervalKm: 14000
  },
  '2': {
    id: '2',
    name: 'Honda Jazz 2014',
    plate: '3กส 7666',
    hexColor: '#FACC15',
    iconUrl: CAR_APP_BASE_URL + '/Files/icon-jazz.png',
    oilIntervalKm: 10000,
    airFilterIntervalKm: 30000,
    tireRotateIntervalKm: 10000
  }
};

const SNAP_EARLY_RATIO = 0.15; // ก่อนกำหนดไม่เกิน 15%
const SNAP_LATE_RATIO = 0.20;  // ช้ากว่ากำหนดไม่เกิน 20%

/**
 * เมนูบน Google Sheet สำหรับกดอนุญาตสิทธิ์และซิงก์บัตรรถยนต์
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🚗 บัตรรถยนต์ Wallet')
      .addItem('1. ซิงก์บัตรทั้ง 2 คัน + ติดตั้ง Trigger รายวัน (01:00)', 'authorizeAndSyncAllCarPasses')
      .addToUi();
  } catch (e) {}
}

/**
 * เรียกจากเมนูใน Sheet หรือปุ่ม Run ใน Apps Script Editor เพื่ออนุญาตสิทธิ์ UrlFetchApp + ScriptApp ครั้งเดียว
 */
function authorizeAndSyncAllCarPasses() {
  installDailyCarPassTrigger();
  const res = syncAllCarWalletPasses();
  Logger.log('Almera Save URL: ' + res.car1.saveUrl);
  Logger.log('Jazz Save URL: ' + res.car2.saveUrl);
  try {
    SpreadsheetApp.getUi().alert(
      'ซิงก์บัตรรถยนต์ทั้ง 2 คัน และตั้ง Trigger รายวันสำเร็จ!\n' +
      'เปิดหน้า https://lpd11.github.io/car-tracker/pass-manage.html เพื่อกดเพิ่มบัตรเข้า Google Wallet ได้เลยครับ'
    );
  } catch (e) {}
  return res;
}

/**
 * เปิดหรือสร้างแท็บ car_pass_config สำหรับเก็บวันหมดอายุภาษี/ประกัน และสถานะเลื่อนเตือน (Snooze)
 */
function getCarPassConfigSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('car_pass_config');
  if (!sheet) {
    sheet = ss.insertSheet('car_pass_config');
    const headers = [
      'car_id',
      'tax_expire_date',
      'ins_expire_date',
      'ins_company',
      'ins_policy_no',
      'ins_phone',
      'snooze_until',
      'last_notified_key'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eaeaea');
    sheet.getRange('A:H').setNumberFormat('@');
    sheet.appendRow(['1', '', '', '', '', '', '', '']);
    sheet.appendRow(['2', '', '', '', '', '', '', '']);
  }
  return sheet;
}

/**
 * อ่านค่าตั้งค่าภาษี/ประกัน/Snooze ของรถแต่ละคัน
 */
function getCarPassConfig(carId) {
  const sheet = getCarPassConfigSheet();
  const rows = getRowsData(sheet);
  const found = rows.find(r => String(r.car_id) === String(carId));
  if (!found) {
    return {
      car_id: String(carId),
      tax_expire_date: '',
      ins_expire_date: '',
      ins_company: '',
      ins_policy_no: '',
      ins_phone: '',
      snooze_until: '',
      last_notified_key: ''
    };
  }
  return {
    car_id: String(found.car_id),
    tax_expire_date: normalizeCarDateStr(found.tax_expire_date),
    ins_expire_date: normalizeCarDateStr(found.ins_expire_date),
    ins_company: String(found.ins_company || '').trim(),
    ins_policy_no: String(found.ins_policy_no || '').trim(),
    ins_phone: String(found.ins_phone || '').trim(),
    snooze_until: normalizeCarDateStr(found.snooze_until),
    last_notified_key: String(found.last_notified_key || '').trim(),
    _rowNum: found._rowNum
  };
}

/**
 * บันทึกการตั้งค่าภาษี/ประกัน หรือการกดเลื่อนเตือน (Snooze) แล้วซิงก์บัตรทันที
 */
function updateCarPassConfig(carId, updates) {
  const sheet = getCarPassConfigSheet();
  const rows = getRowsData(sheet);
  let target = rows.find(r => String(r.car_id) === String(carId));

  if (!target) {
    const newRowNum = sheet.getLastRow() + 1;
    sheet.getRange(newRowNum, 1, 1, 8).setNumberFormat('@');
    sheet.getRange(newRowNum, 1, 1, 8).setValues([[String(carId), '', '', '', '', '', '', '']]);
    target = { _rowNum: newRowNum };
  }

  const current = getCarPassConfig(carId);
  const nextVals = [
    String(carId),
    updates.tax_expire_date !== undefined ? normalizeCarDateStr(updates.tax_expire_date) : current.tax_expire_date,
    updates.ins_expire_date !== undefined ? normalizeCarDateStr(updates.ins_expire_date) : current.ins_expire_date,
    updates.ins_company !== undefined ? String(updates.ins_company || '').trim() : current.ins_company,
    updates.ins_policy_no !== undefined ? String(updates.ins_policy_no || '').trim() : current.ins_policy_no,
    updates.ins_phone !== undefined ? String(updates.ins_phone || '').trim() : current.ins_phone,
    updates.snooze_until !== undefined ? normalizeCarDateStr(updates.snooze_until) : current.snooze_until,
    updates.last_notified_key !== undefined ? String(updates.last_notified_key || '').trim() : current.last_notified_key
  ];

  sheet.getRange(target._rowNum, 1, 1, 8).setNumberFormat('@');
  sheet.getRange(target._rowNum, 1, 1, 8).setValues([nextVals]);

  // ซิงก์ขึ้นบัตร Google Wallet ทันที
  let walletRes = null;
  try {
    walletRes = syncCarWalletPass(carId);
  } catch (e) {
    Logger.log('syncCarWalletPass error: ' + e.message);
  }

  return {
    config: getCarPassConfig(carId),
    walletSynced: Boolean(walletRes),
    saveUrl: walletRes ? walletRes.saveUrl : ''
  };
}

/**
 * ตั้งค่าเลื่อนการแจ้งเตือน (Snooze) ออกไป N วัน หรือระบุวันที่
 */
function snoozeCarPassAlert(carId, daysOrDate) {
  const today = carTodayStr();
  let snoozeUntil = '';
  if (daysOrDate === 'clear' || daysOrDate === 0 || daysOrDate === '0') {
    snoozeUntil = '';
  } else if (typeof daysOrDate === 'number' || /^\d+$/.test(String(daysOrDate).trim())) {
    snoozeUntil = carAddDays(today, Number(daysOrDate));
  } else {
    snoozeUntil = normalizeCarDateStr(daysOrDate);
  }

  return updateCarPassConfig(carId, {
    snooze_until: snoozeUntil,
    last_notified_key: '' // ล้าง key เพื่อให้เตือนอีกครั้งเมื่อถึงวัน snooze_until
  });
}

// ==========================================
// SMART MAINTENANCE & SNAP-TO-SLOT (-15% / +20%)
// ==========================================

/**
 * คำนวณเลขไมล์รอบถัดไปตามกฎ Snap-to-Standard-Slot (ก่อนไม่เกิน 15% / ช้าไม่เกิน 20%)
 * @param {number} lastDoneKm เลขไมล์ที่ทำครั้งล่าสุด
 * @param {number} intervalKm รอบมาตรฐานของอะไหล่ (เช่น 7000, 10000, 40000, 100000)
 * @return {{nextDueKm: number, snappedSlotKm: number|null}}
 */
function calcNextSnapKm(lastDoneKm, intervalKm) {
  const km = Number(lastDoneKm);
  const interval = Number(intervalKm);
  if (!km || km <= 0 || !interval || interval <= 0) {
    return { nextDueKm: interval, snappedSlotKm: null };
  }

  const nearestSlot = Math.round(km / interval) * interval;
  const diff = km - nearestSlot; // ติดลบ = ทำก่อนกำหนด, บวก = ทำช้ากว่ากำหนด
  const earlyLimit = -SNAP_EARLY_RATIO * interval; // -15%
  const lateLimit = SNAP_LATE_RATIO * interval;    // +20%

  if (nearestSlot > 0 && diff >= earlyLimit && diff <= lateLimit) {
    return {
      nextDueKm: nearestSlot + interval,
      snappedSlotKm: nearestSlot
    };
  }

  return {
    nextDueKm: km + interval,
    snappedSlotKm: null
  };
}

/**
 * วิเคราะห์ข้อมูลรถ เลขไมล์ล่าสุด รอบเช็กระยะ และรายการอะไหล่ทั้งหมด
 */
function computeCarPassStatus(carId) {
  const cid = String(carId || '1');
  const meta = CAR_META[cid] || CAR_META['1'];
  const config = getCarPassConfig(cid);

  const fuels = getFuelRecords(cid) || [];
  const maints = getMaintenanceRecords(cid) || [];

  // เรียงตามเลขไมล์มากไปน้อย
  const sortedFuels = fuels
    .filter(f => Number(f.odometer_km) > 0)
    .sort((a, b) => Number(b.odometer_km) - Number(a.odometer_km));

  const sortedMaints = maints
    .filter(m => Number(m.odometer_km) > 0)
    .sort((a, b) => Number(b.odometer_km) - Number(a.odometer_km));

  const maxFuelOdo = sortedFuels.length > 0 ? Number(sortedFuels[0].odometer_km) : 0;
  const maxMaintOdo = sortedMaints.length > 0 ? Number(sortedMaints[0].odometer_km) : 0;
  const currentOdo = Math.max(maxFuelOdo, maxMaintOdo);

  const latestFuel = sortedFuels.length > 0 ? sortedFuels[0] : null;
  const latestMaint = sortedMaints.length > 0 ? sortedMaints[0] : null;

  // รายการอะไหล่ที่ระบบจับคู่อัตโนมัติจากประวัติซ่อมบำรุง
  const partRules = [
    {
      id: 'oil',
      name: 'น้ำมันเครื่อง + กรอง',
      keywords: ['น้ำมันเครื่อง', 'ถ่ายน้ำมันเครื่อง'],
      intervalKm: meta.oilIntervalKm,
      isPrimary: true
    },
    {
      id: 'cvt',
      name: 'น้ำมันเกียร์ CVT',
      keywords: ['น้ำมันเกียร์'],
      intervalKm: 40000,
      isPrimary: true
    },
    {
      id: 'brake_fluid',
      name: 'น้ำมันเบรก',
      keywords: ['น้ำมันเบรค', 'น้ำมันเบรก'],
      intervalKm: 40000,
      isPrimary: true
    },
    {
      id: 'air_filter',
      name: 'กรองอากาศเครื่องยนต์',
      keywords: ['กรองอากาศ'],
      intervalKm: meta.airFilterIntervalKm,
      isPrimary: false
    },
    {
      id: 'ac_filter',
      name: 'ไส้กรองแอร์',
      keywords: ['กรองแอร์'],
      intervalKm: 20000,
      isPrimary: false
    },
    {
      id: 'tire_rotate',
      name: 'สลับยาง / ถ่วงล้อ',
      keywords: ['สลับยาง'],
      intervalKm: meta.tireRotateIntervalKm,
      isPrimary: false
    },
    {
      id: 'spark_plug',
      name: 'หัวเทียน Iridium',
      keywords: ['หัวเทียน'],
      intervalKm: 100000,
      isPrimary: true
    }
  ];

  const trackedParts = [];

  partRules.forEach(rule => {
    // หาบันทึกซ่อมครั้งล่าสุดที่มีรายการตรงกับ keyword
    const matchedMaint = sortedMaints.find(m => {
      const itemNames = (m.items || []).map(it => String(it.service_name || '')).join(' ');
      const noteText = String(m.notes || '');
      const combined = itemNames + ' ' + noteText;
      return rule.keywords.some(kw => combined.indexOf(kw) !== -1);
    });

    if (matchedMaint) {
      const lastKm = Number(matchedMaint.odometer_km);
      const lastDate = normalizeCarDateStr(matchedMaint.date);
      const snap = calcNextSnapKm(lastKm, rule.intervalKm);
      const remainingKm = snap.nextDueKm - currentOdo;
      trackedParts.push({
        id: rule.id,
        name: rule.name,
        hasHistory: true,
        lastKm: lastKm,
        lastDate: lastDate,
        lastDateThai: formatCarThaiDateShort(lastDate),
        intervalKm: rule.intervalKm,
        snappedSlotKm: snap.snappedSlotKm,
        nextDueKm: snap.nextDueKm,
        remainingKm: remainingKm,
        isPrimary: rule.isPrimary
      });
    } else if (rule.id === 'oil' && currentOdo > 0) {
      // กรณีรถคันนั้นยังไม่เคยลงบันทึกเปลี่ยนน้ำมันเครื่องในแอป ให้คำนวณสล็อตมาตรฐานถัดไป
      const nextSlot = (Math.floor(currentOdo / rule.intervalKm) + 1) * rule.intervalKm;
      trackedParts.push({
        id: rule.id,
        name: rule.name,
        hasHistory: false,
        lastKm: 0,
        lastDate: '',
        lastDateThai: '-',
        intervalKm: rule.intervalKm,
        snappedSlotKm: null,
        nextDueKm: nextSlot,
        remainingKm: nextSlot - currentOdo,
        isPrimary: true
      });
    }
  });

  // รายการตามระยะเวลา: แบตเตอรี่ (2 ปี) และ ใบปัดน้ำฝน (1 ปี)
  const timePartRules = [
    { id: 'battery', name: 'แบตเตอรี่', keywords: ['แบตเตอรี่', 'แบต'], months: 24 },
    { id: 'wiper', name: 'ใบปัดน้ำฝน', keywords: ['ใบปัดน้ำฝน'], months: 12 }
  ];
  const trackedTimeParts = [];
  timePartRules.forEach(tr => {
    const matched = sortedMaints.find(m => {
      const combined = (m.items || []).map(it => String(it.service_name || '')).join(' ') + ' ' + String(m.notes || '');
      return tr.keywords.some(kw => combined.indexOf(kw) !== -1);
    });
    if (matched) {
      const lastDate = normalizeCarDateStr(matched.date);
      const dueDate = carAddMonths(lastDate, tr.months);
      const remDays = carDaysBetween(carTodayStr(), dueDate);
      trackedTimeParts.push({
        id: tr.id,
        name: tr.name,
        lastKm: Number(matched.odometer_km),
        lastDate: lastDate,
        lastDateThai: formatCarThaiDateShort(lastDate),
        dueDate: dueDate,
        dueDateThai: formatCarThaiDateShort(dueDate),
        remainingDays: remDays
      });
    }
  });

  // หาเป้าหมายเช็กระยะรอบถัดไปสำหรับแสดงหน้าบัตร
  // 1) ถ้าบันทึกซ่อมล่าสุดมีการระบุ next_km ไว้โดยตรง และยังไม่ผ่านไมล์นั้น ให้ใช้ค่านั้นก่อน
  let primaryNextKm = 0;
  let primaryLabel = 'น้ำมันเครื่อง';
  if (latestMaint && Number(latestMaint.next_km) > currentOdo) {
    primaryNextKm = Number(latestMaint.next_km);
    primaryLabel = 'ตามนัด';
  } else {
    // 2) ใช้รายการที่ใกล้ถึงกำหนดที่สุดจาก trackedParts
    const candidates = trackedParts.filter(p => p.isPrimary || p.remainingKm <= 2000);
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.remainingKm - b.remainingKm);
      primaryNextKm = candidates[0].nextDueKm;
      primaryLabel = candidates[0].name;
    } else if (trackedParts.length > 0) {
      primaryNextKm = trackedParts[0].nextDueKm;
      primaryLabel = trackedParts[0].name;
    }
  }

  const primaryRemainingKm = primaryNextKm > 0 ? (primaryNextKm - currentOdo) : 0;

  // คำนวณวันคงเหลือ ภาษี/พ.ร.บ. และ ประกันภัย
  const today = carTodayStr();
  let taxDisplay = 'กดตั้งค่าหลังบัตร';
  let taxRemainingDays = null;
  if (config.tax_expire_date) {
    taxRemainingDays = carDaysBetween(today, config.tax_expire_date);
    const dText = formatCarThaiDateShort(config.tax_expire_date);
    taxDisplay = taxRemainingDays < 0
      ? `${dText} (เกิน ${Math.abs(taxRemainingDays)} วัน!)`
      : `${dText} (${taxRemainingDays} วัน)`;
  }

  let insDisplay = 'กดตั้งค่าหลังบัตร';
  let insRemainingDays = null;
  if (config.ins_expire_date) {
    insRemainingDays = carDaysBetween(today, config.ins_expire_date);
    const dText = formatCarThaiDateShort(config.ins_expire_date);
    insDisplay = insRemainingDays < 0
      ? `${dText} (เกิน ${Math.abs(insRemainingDays)} วัน!)`
      : `${dText} (${insRemainingDays} วัน)`;
  }

  return {
    carId: cid,
    meta: meta,
    config: config,
    currentOdo: currentOdo,
    currentOdoText: currentOdo > 0 ? `${formatNumberCommas(currentOdo)} กม.` : '-',
    primaryNextKm: primaryNextKm,
    primaryRemainingKm: primaryRemainingKm,
    primaryLabel: primaryLabel,
    nextMaintFrontText: primaryNextKm > 0
      ? (primaryRemainingKm <= 0
          ? `ครบกำหนด! (${formatNumberCommas(primaryNextKm)})`
          : `อีก ${formatNumberCommas(primaryRemainingKm)} กม.`)
      : '-',
    taxDisplay: taxDisplay,
    taxRemainingDays: taxRemainingDays,
    insDisplay: insDisplay,
    insRemainingDays: insRemainingDays,
    trackedParts: trackedParts,
    trackedTimeParts: trackedTimeParts,
    latestFuel: latestFuel,
    recentMaints: sortedMaints.slice(0, 5)
  };
}

// ==========================================
// GOOGLE WALLET PASS BUILDER & SYNC
// ==========================================

function getCarWalletCredentials() {
  const props = PropertiesService.getScriptProperties();
  const saJson = props.getProperty('SA_KEY_JSON');
  const issuerId = (props.getProperty('ISSUER_ID') || CAR_DEFAULT_ISSUER_ID).trim();
  if (!saJson) {
    throw new Error('ยังไม่ได้ตั้งค่า SA_KEY_JSON ใน Script Properties ของ Car-Tracker');
  }
  const sa = JSON.parse(saJson);
  return { sa, issuerId };
}

function carBase64UrlEncode(input) {
  const encoded = typeof input === 'string'
    ? Utilities.base64EncodeWebSafe(input, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(input);
  return encoded.replace(/=+$/, '');
}

function carSignJwtRs256(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = carBase64UrlEncode(JSON.stringify(header)) + '.' + carBase64UrlEncode(JSON.stringify(payload));
  const signatureBytes = Utilities.computeRsaSha256Signature(signingInput, privateKeyPem);
  return signingInput + '.' + carBase64UrlEncode(signatureBytes);
}

function getCarWalletAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('car_wallet_access_token');
  if (cached) return cached;

  const { sa } = getCarWalletCredentials();
  const nowSec = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: sa.client_email,
    scope: CAR_WALLET_SCOPE,
    aud: CAR_OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  };

  const assertion = carSignJwtRs256(claimSet, sa.private_key);
  const res = UrlFetchApp.fetch(CAR_OAUTH_TOKEN_URL, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('ขอ Access Token ไม่สำเร็จ: ' + res.getContentText());
  }

  const data = JSON.parse(res.getContentText());
  cache.put('car_wallet_access_token', data.access_token, 3300);
  return data.access_token;
}

function callCarWalletApi(method, path, body) {
  const token = getCarWalletAccessToken();
  const options = {
    method: method.toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(CAR_WALLET_API_BASE + path, options);
  const code = res.getResponseCode();
  const raw = res.getContentText();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {}
  return { code, data, raw };
}

/**
 * สร้างหรืออัปเดต GenericClass สำหรับบัตรรถยนต์ (แบบ B: 2 แถวหน้าบัตร)
 */
function ensureCarGenericClass(classId) {
  const classResource = {
    id: classId,
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['odo']" }]
                }
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['next_maint']" }]
                }
              }
            }
          },
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['tax_exp']" }]
                }
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['ins_exp']" }]
                }
              }
            }
          }
        ]
      }
    }
  };

  const getRes = callCarWalletApi('GET', `/genericClass/${encodeURIComponent(classId)}`);
  if (getRes.code === 404) {
    const postRes = callCarWalletApi('POST', '/genericClass', classResource);
    if (postRes.code >= 300) throw new Error('สร้าง GenericClass ไม่สำเร็จ: ' + postRes.raw);
    return postRes.data;
  } else if (getRes.code === 200) {
    const patchRes = callCarWalletApi('PATCH', `/genericClass/${encodeURIComponent(classId)}`, classResource);
    if (patchRes.code >= 300) throw new Error('อัปเดต GenericClass ไม่สำเร็จ: ' + patchRes.raw);
    return patchRes.data;
  } else {
    throw new Error('ตรวจสอบ GenericClass ไม่สำเร็จ: ' + getRes.raw);
  }
}

/**
 * สร้าง Payload ของบัตรรถยนต์แต่ละคัน (ไม่มี QR Code ด้านล่าง)
 */
function buildCarGenericObject(carId) {
  const { issuerId } = getCarWalletCredentials();
  const status = computeCarPassStatus(carId);
  const classId = `${issuerId}.car_tracker_card`;
  const objectId = `${issuerId}.car_pass_${status.carId}`;

  // 1. ตารางสถานะอะไหล่แต่ละชิ้น (Smart Snap -15% / +20%)
  const partLines = status.trackedParts.map(p => {
    const remStr = p.remainingKm <= 0
      ? `⚠️ ครบกำหนดแล้ว! (เป้า ${formatNumberCommas(p.nextDueKm)} กม.)`
      : `เหลือ ${formatNumberCommas(p.remainingKm)} กม. (ครบที่ ${formatNumberCommas(p.nextDueKm)} กม.)`;
    const histStr = p.hasHistory
      ? `ทำล่าสุด ${formatNumberCommas(p.lastKm)} กม. (${p.lastDateThai})`
      : 'ยังไม่มีประวัติในระบบ';
    return `• ${p.name}: ${remStr}\n  [${histStr}]`;
  });

  status.trackedTimeParts.forEach(tp => {
    const remStr = tp.remainingDays <= 0
      ? `⚠️ ครบกำหนดเปลี่ยน (${tp.dueDateThai})`
      : `อีก ${tp.remainingDays} วัน (ครบ ${tp.dueDateThai})`;
    partLines.push(`• ${tp.name}: ${remStr}\n  [เปลี่ยนล่าสุด ${tp.lastDateThai} ที่ ${formatNumberCommas(tp.lastKm)} กม.]`);
  });

  const partsBody = partLines.length > 0 ? partLines.join('\n\n') : 'ยังไม่มีข้อมูลอะไหล่';

  // 2. ข้อมูลประกันภัย / พ.ร.บ. / ภาษี / Snooze
  const cfg = status.config;
  const insLines = [
    `• ภาษี & พ.ร.บ.: ${status.taxDisplay}`,
    `• ประกันภัยรถยนต์: ${status.insDisplay}`,
    `• บริษัทประกัน: ${cfg.ins_company || '-'}`,
    `• เลขกรมธรรม์: ${cfg.ins_policy_no || '-'}`,
    `• เบอร์ฉุกเฉิน: ${cfg.ins_phone || '-'}`
  ];
  if (cfg.snooze_until) {
    insLines.push(`⏰ เลื่อนการแจ้งเตือนไว้ถึงวันที่: ${formatCarThaiDateShort(cfg.snooze_until)} (${formatCarSheetDateThai(cfg.snooze_until)})`);
  }

  // 3. ประวัติซ่อมบำรุงล่าสุด 5 ครั้ง
  const maintLines = status.recentMaints.map(m => {
    const dStr = formatCarThaiDateShort(normalizeCarDateStr(m.date));
    const itemsStr = (m.items || []).map(i => i.service_name).join(', ') || m.notes || '-';
    return `• ${dStr} (${formatNumberCommas(Number(m.odometer_km))} กม.) — ${itemsStr} (${formatNumberCommas(Number(m.total_cost || 0))}฿)`;
  }).join('\n') || 'ยังไม่มีประวัติซ่อมบำรุง';

  // 4. เติมน้ำมันล่าสุด
  let fuelBody = 'ยังไม่มีประวัติเติมน้ำมัน';
  if (status.latestFuel) {
    const lf = status.latestFuel;
    const fDate = formatCarThaiDateShort(normalizeCarDateStr(lf.date));
    fuelBody = `${fDate} · ไมล์ ${formatNumberCommas(Number(lf.odometer_km))} กม. · ${lf.station || '-'} (${lf.fuel_type || '-'} · ${lf.efficiency_km_per_liter || '-'} กม./ลิตร · ${formatNumberCommas(Number(lf.total_cost || 0))}฿)`;
  }

  // 5. ลิงก์กดจากด้านหลังบัตร (linksModuleData)
  const uris = [
    {
      id: 'snooze_link',
      uri: `${CAR_APP_BASE_URL}/pass-manage.html?car=${status.carId}`,
      description: '⏰ เลื่อนการแจ้งเตือน (Snooze) / ตั้งค่าภาษี-ประกัน'
    },
    {
      id: 'open_app',
      uri: `${CAR_APP_BASE_URL}/home.html?menu=1`,
      description: '🚗 เปิดแอป Car Tracker (บันทึกน้ำมัน / ซ่อมบำรุง)'
    }
  ];

  if (cfg.ins_phone) {
    const cleanPhone = cfg.ins_phone.replace(/[^0-9+]/g, '');
    if (cleanPhone) {
      uris.push({
        id: 'call_ins',
        uri: `tel:${cleanPhone}`,
        description: `📞 โทรฉุกเฉินประกันภัย (${cfg.ins_company || ''} ${cfg.ins_phone})`.trim()
      });
    }
  }

  const objectPayload = {
    id: objectId,
    classId: classId,
    genericType: 'GENERIC_OTHER',
    state: 'ACTIVE',
    hexBackgroundColor: status.meta.hexColor,
    logo: {
      sourceUri: {
        uri: status.meta.iconUrl
      },
      contentDescription: {
        defaultValue: {
          language: 'th',
          value: status.meta.name
        }
      }
    },
    cardTitle: {
      defaultValue: {
        language: 'th',
        value: 'สมุดคู่มือรถดิจิทัล · Car Tracker'
      }
    },
    subheader: {
      defaultValue: {
        language: 'th',
        value: status.meta.name
      }
    },
    header: {
      defaultValue: {
        language: 'th',
        value: `ทะเบียน ${status.meta.plate}`
      }
    },
    textModulesData: [
      {
        id: 'odo',
        header: 'เลขไมล์ล่าสุด',
        body: status.currentOdoText
      },
      {
        id: 'next_maint',
        header: 'เช็กระยะถัดไป',
        body: status.nextMaintFrontText
      },
      {
        id: 'tax_exp',
        header: 'ภาษี & พ.ร.บ.',
        body: status.taxDisplay
      },
      {
        id: 'ins_exp',
        header: 'ประกันภัยรถยนต์',
        body: status.insDisplay
      },
      {
        id: 'parts_schedule',
        header: '🔧 กำหนดเปลี่ยนอะไหล่ตามระยะ (Snap -15%/+20%)',
        body: partsBody
      },
      {
        id: 'ins_tax_detail',
        header: '🛡️ ข้อมูลประกันภัย · พ.ร.บ. · ภาษี',
        body: insLines.join('\n')
      },
      {
        id: 'recent_maint',
        header: '📋 ประวัติซ่อมบำรุง 5 ครั้งล่าสุด',
        body: maintLines
      },
      {
        id: 'recent_fuel',
        header: '⛽ เติมน้ำมันครั้งล่าสุด',
        body: fuelBody
      }
    ],
    linksModuleData: {
      uris: uris
    }
  };

  return { classId, objectId, objectPayload, status };
}

/**
 * ซิงก์บัตรรถยนต์คันที่ระบุขึ้น Google Wallet และตรวจเงื่อนไขแจ้งเตือน
 */
function syncCarWalletPass(carId) {
  const { sa } = getCarWalletCredentials();
  const { classId, objectId, objectPayload, status } = buildCarGenericObject(carId);
  ensureCarGenericClass(classId);

  const getRes = callCarWalletApi('GET', `/genericObject/${encodeURIComponent(objectId)}`);
  if (getRes.code === 404) {
    const postRes = callCarWalletApi('POST', '/genericObject', objectPayload);
    if (postRes.code >= 300) throw new Error('สร้าง GenericObject ไม่สำเร็จ: ' + postRes.raw);
  } else if (getRes.code === 200) {
    const patchRes = callCarWalletApi('PATCH', `/genericObject/${encodeURIComponent(objectId)}`, objectPayload);
    if (patchRes.code >= 300) throw new Error('อัปเดต GenericObject ไม่สำเร็จ: ' + patchRes.raw);
  } else {
    throw new Error('ตรวจสอบ GenericObject ไม่สำเร็จ: ' + getRes.raw);
  }

  const claims = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [],
    payload: {
      genericObjects: [{ id: objectId }]
    }
  };
  const saveUrl = `https://pay.google.com/gp/v/save/${carSignJwtRs256(claims, sa.private_key)}`;

  return { classId, objectId, saveUrl, status };
}

/**
 * ซิงก์บัตรรถยนต์ทั้ง 2 คันพร้อมกัน
 */
function syncAllCarWalletPasses() {
  const r1 = syncCarWalletPass('1');
  const r2 = syncCarWalletPass('2');
  return { car1: r1, car2: r2 };
}

/**
 * ส่งแจ้งเตือนขึ้นบัตรรถยนต์ผ่าน addMessage (TEXT_AND_NOTIFY)
 */
function sendCarWalletNotification(carId, headerText, bodyText, msgId) {
  const { issuerId } = getCarWalletCredentials();
  const objectId = `${issuerId}.car_pass_${carId}`;
  const payload = {
    message: {
      id: msgId || ('car_msg_' + Date.now()),
      header: headerText,
      body: bodyText,
      messageType: 'TEXT_AND_NOTIFY'
    }
  };
  return callCarWalletApi('POST', `/genericObject/${encodeURIComponent(objectId)}/addMessage`, payload);
}

/**
 * ตรวจสอบเงื่อนไขแจ้งเตือนของรถ (รองรับการเลื่อนเตือน Snooze)
 */
function checkAndNotifyCarPass(carId) {
  const syncRes = syncCarWalletPass(carId);
  const st = syncRes.status;
  const cfg = st.config;
  const today = carTodayStr();

  // หากตั้งเลื่อนเตือน (Snooze) ไว้ และยังไม่ถึงวันที่นัดเตือน ให้ข้ามไปก่อน
  if (cfg.snooze_until && today < cfg.snooze_until) {
    return { notified: false, reason: 'snoozed_until_' + cfg.snooze_until };
  }

  const alerts = [];

  // 1. เช็กระยะอะไหล่ตามไมล์ (เตือนเมื่อเหลือ <= 500 กม.)
  st.trackedParts.forEach(p => {
    if (p.remainingKm <= 500) {
      alerts.push(`${p.name} (เหลือ ${formatNumberCommas(p.remainingKm)} กม. · ครบที่ ${formatNumberCommas(p.nextDueKm)} กม.)`);
    }
  });

  // 2. เช็กภาษี & พ.ร.บ. (เตือนเมื่อเหลือ <= 30 วัน)
  if (st.taxRemainingDays !== null && (st.taxRemainingDays === 30 || st.taxRemainingDays === 7 || st.taxRemainingDays <= 0 || cfg.snooze_until === today)) {
    if (st.taxRemainingDays <= 30) {
      alerts.push(`ภาษี & พ.ร.บ. ครบกำหนด ${formatCarThaiDateShort(cfg.tax_expire_date)} (อีก ${st.taxRemainingDays} วัน)`);
    }
  }

  // 3. เช็กประกันภัย (เตือนเมื่อเหลือ <= 30 วัน)
  if (st.insRemainingDays !== null && (st.insRemainingDays === 30 || st.insRemainingDays === 7 || st.insRemainingDays <= 0 || cfg.snooze_until === today)) {
    if (st.insRemainingDays <= 30) {
      alerts.push(`ประกันภัยรถยนต์ ครบกำหนด ${formatCarThaiDateShort(cfg.ins_expire_date)} (อีก ${st.insRemainingDays} วัน)`);
    }
  }

  if (alerts.length === 0) {
    return { notified: false, reason: 'no_due_items' };
  }

  const alertKey = `${today}_${alerts.join('|')}`;
  if (cfg.last_notified_key === alertKey) {
    return { notified: false, reason: 'already_notified_today' };
  }

  const header = `🔔 แจ้งเตือนรถ ${st.meta.plate} (${st.meta.name})`;
  const body = alerts.join('\n') + '\n(กดลิงก์หลังบัตรเพื่อเลื่อนการแจ้งเตือนได้)';
  sendCarWalletNotification(carId, header, body, 'alert_' + carId + '_' + Date.now());

  // เคลียร์ snooze_until ที่ถึงกำหนดแล้ว และบันทึก last_notified_key กันส่งซ้ำในวันเดียวกัน
  updateCarPassConfig(carId, {
    snooze_until: cfg.snooze_until && today >= cfg.snooze_until ? '' : cfg.snooze_until,
    last_notified_key: alertKey
  });

  return { notified: true, alerts: alerts };
}

/**
 * Trigger รายวัน (01:00 น.) สำหรับอัปเดตบัตรรถยนต์ทั้ง 2 คันและส่งแจ้งเตือน
 */
function runDailyCarPassUpdate() {
  const r1 = checkAndNotifyCarPass('1');
  const r2 = checkAndNotifyCarPass('2');
  Logger.log('runDailyCarPassUpdate: ' + JSON.stringify({ car1: r1, car2: r2 }));
}

function installDailyCarPassTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDailyCarPassUpdate') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runDailyCarPassUpdate')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
  return 'ติดตั้ง Trigger รายวันสำหรับบัตรรถยนต์เรียบร้อยแล้ว';
}

// ==========================================
// DATE & NUMBER HELPERS FOR CAR PASS
// ==========================================

const CAR_THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function carTodayStr() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function normalizeCarDateStr(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    let y = val.getFullYear();
    if (y > 2400) y -= 543;
    return `${y}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  // DD-MM-YYYY หรือ DD/MM/YYYY
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    let yr = parseInt(m[3], 10);
    if (yr > 2400) yr -= 543;
    return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // YYYY-MM-DD หรือ ISO string
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    let yr = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (yr > 2400) yr -= 543;
    return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return Utilities.formatDate(dt, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return '';
}

function parseCarDate(dateStr) {
  const norm = normalizeCarDateStr(dateStr);
  const parts = norm.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
}

function carAddDays(dateStr, days) {
  const dt = parseCarDate(dateStr);
  dt.setDate(dt.getDate() + Number(days));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function carAddMonths(dateStr, months) {
  const dt = parseCarDate(dateStr);
  dt.setMonth(dt.getMonth() + Number(months));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function carDaysBetween(fromStr, toStr) {
  const d1 = parseCarDate(fromStr);
  const d2 = parseCarDate(toStr);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCarThaiDateShort(dateStr) {
  const norm = normalizeCarDateStr(dateStr);
  if (!norm) return '-';
  const dt = parseCarDate(norm);
  const d = dt.getDate();
  const m = CAR_THAI_MONTHS[dt.getMonth()];
  const y = String((dt.getFullYear() + 543) % 100).padStart(2, '0');
  return `${d} ${m} ${y}`;
}

function formatCarSheetDateThai(dateStr) {
  const norm = normalizeCarDateStr(dateStr);
  if (!norm) return '';
  const dt = parseCarDate(norm);
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear() + 543;
  return `${d}-${m}-${y}`;
}

function formatNumberCommas(n) {
  const num = Math.round(Number(n || 0));
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
