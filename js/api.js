/**
 * CAR TRACKER - API BRIDGE TO GOOGLE APPS SCRIPT
 * 
 * NOTE: 
 * - When you deploy your Google Apps Script as a Web App, paste your Web App URL below.
 * - If the URL remains the default placeholder, the app will automatically run in 
 *   "MOCK MODE" using LocalStorage as a local database so you can test it immediately!
 */

const API_URL = 'https://script.google.com/macros/s/AKfycbwspQVRxmbI8qr5kLu80fHdgrypzVWF0i85tc-CmZw2CNIxBJfP4urHfqbOuyZRcP9l/exec';

// Check if we should run in mock database mode
const isMockMode = !API_URL || API_URL.startsWith('YOUR_APPS_SCRIPT_WEB_APP');

if (isMockMode) {
  console.log('🚀 Running in MOCK MODE (using LocalStorage for local database)');
  initMockDatabase();
} else {
  console.log('📡 Running in LIVE API MODE (connecting to Google Sheets)');
}

// ==========================================
// CLIENT-SIDE CACHE (persistent — localStorage, stale-while-revalidate)
//
// เก็บข้อมูลประวัติล่าสุดไว้ในเครื่อง เพื่อให้เปิดหน้าครั้งต่อ ๆ ไปขึ้นทันที
// (ไม่ต้องรอ Apps Script cold start ~20 วิ) แล้วค่อยดึงของใหม่เบื้องหลัง
// ==========================================
const _HISTORY_CACHE_PREFIX = 'car_tracker_history_cache_';
const _HISTORY_CACHE_TTL = 2 * 60 * 1000; // ถือว่า "สด" ภายใน 2 นาที (ข้ามการ refresh เบื้องหลัง)

function _historyCacheKey(carId) {
  return _HISTORY_CACHE_PREFIX + String(carId);
}

/**
 * คืนข้อมูล cache ที่เก็บไว้ (ไม่ว่าจะเก่าแค่ไหน) — null ถ้าไม่มี/อ่านไม่ได้
 * ให้ SWR โชว์ของเก่าทันทีแล้วค่อย refresh
 */
function getHistoryCache(carId) {
  try {
    const raw = localStorage.getItem(_historyCacheKey(carId));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry && entry.data ? entry.data : null;
  } catch (e) {
    return null;
  }
}

/**
 * cache ยัง "สด" อยู่ไหม (ภายใน TTL) — ใช้ตัดสินว่าจะข้าม background refresh หรือไม่
 */
function isHistoryCacheFresh(carId) {
  try {
    const raw = localStorage.getItem(_historyCacheKey(carId));
    if (!raw) return false;
    const entry = JSON.parse(raw);
    return entry && (Date.now() - entry.ts) <= _HISTORY_CACHE_TTL;
  } catch (e) {
    return false;
  }
}

function setHistoryCache(carId, data) {
  try {
    localStorage.setItem(_historyCacheKey(carId), JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {
    // localStorage เต็ม/ปิด — ข้ามไป ไม่ให้กระทบการทำงานหลัก
    console.warn('History cache write failed:', e);
  }
}

function invalidateHistoryCache(carId) {
  if (carId != null) {
    localStorage.removeItem(_historyCacheKey(carId));
  } else {
    Object.keys(localStorage)
      .filter(k => k.startsWith(_HISTORY_CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }
}

/**
 * Perform API request (handles live fetch or mock database fallback)
 * @param {boolean} silent - If true, suppresses error alerts (for background requests)
 */
async function apiRequest(action, method = 'GET', data = null, silent = false) {
  if (isMockMode) {
    return await mockApiRequest(action, method, data);
  }

  try {
    let url = API_URL;
    let options = {
      method: method,
      headers: {
        'Content-Type': 'text/plain' // Using text/plain to avoid CORS preflight issues with Apps Script
      }
    };
    
    if (method === 'GET') {
      const cleanAction = {};
      for (const key in action) {
        if (action[key] !== undefined && action[key] !== null && action[key] !== 'undefined' && action[key] !== 'null' && action[key] !== '') {
          cleanAction[key] = action[key];
        }
      }
      cleanAction['_t'] = new Date().getTime(); // Prevent browser/LINE caching
      const params = new URLSearchParams(cleanAction);
      url = `${API_URL}?${params.toString()}`;
    } else {
      options.body = JSON.stringify(action); // Post requests send action and data wrapped in body
    }
    
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP Error! Status: ${response.status}`);
    
    const json = await response.json();
    if (!json.success) throw new Error(json.error || 'Unknown API Error');
    return json.data;
  } catch (error) {
    console.error('API Call Failed:', error);
    if (!silent) alert('เชื่อมต่อฐานข้อมูลล้มเหลว: ' + error.message);
    throw error;
  }
}

// ==========================================
// EXPOSED API FUNCTIONS
// ==========================================

async function getFuelRecords(carId) {
  return await apiRequest({ action: 'getFuel', carId: carId });
}

async function saveFuelRecord(data) {
  return await apiRequest({ action: 'addFuel', data: data }, 'POST');
}

async function updateFuelRecord(id, data) {
  return await apiRequest({ action: 'updateFuel', id: id, data: data }, 'POST');
}

async function getMaintenanceRecords(carId) {
  return await apiRequest({ action: 'getMaintenance', carId: carId });
}

/**
 * เลขไมล์ล่าสุดจริงของรถคันนี้ — เทียบทั้งฝั่งเติมน้ำมันและซ่อมบำรุงแล้วเอาค่าที่สูงกว่า
 * (ไมล์รถวิ่งขึ้นเรื่อยๆ เลขสูงกว่า = บันทึกล่าสุดกว่าจริง ไม่ว่าจะมาจากรายการประเภทไหน)
 * ใช้ history cache ก่อนถ้ามี (ไม่ต้องรอ network) ไม่มีค่อยดึงสดจากทั้งสอง endpoint
 */
async function getLatestOdometer(carId) {
  const cached = getHistoryCache(carId);
  const [fuel, maint] = (cached && cached.fuel && cached.maintenance)
    ? [cached.fuel, cached.maintenance]
    : await Promise.all([getFuelRecords(carId), getMaintenanceRecords(carId)]);

  const all = [...(fuel || []), ...(maint || [])];
  if (all.length === 0) return null;
  return Math.max(...all.map(r => Number(r.odometer_km) || 0));
}

async function getMaintenanceItems(recordId) {
  return await apiRequest({ action: 'getMaintenanceItems', recordId: recordId });
}

async function saveMaintenanceRecord(data) {
  return await apiRequest({ action: 'addMaintenance', data: data }, 'POST');
}

async function updateMaintenanceRecord(id, data) {
  return await apiRequest({ action: 'updateMaintenance', id: id, data: data }, 'POST');
}

async function deleteRecord(type, id) {
  return await apiRequest({ action: 'deleteRecord', type: type, id: id }, 'POST');
}

async function getServiceTypes() {
  return await apiRequest({ action: 'getServiceTypes' });
}

async function addServiceType(name) {
  return await apiRequest({ action: 'addServiceType', data: { service_name: name } }, 'POST');
}

async function deleteServiceType(name) {
  return await apiRequest({ action: 'deleteServiceType', data: { service_name: name } }, 'POST');
}

async function getDashboardSummary(carId, month) {
  return await apiRequest({ action: 'getSummary', carId: carId, month: month });
}

async function getHistoryPageData(carId, month, silent = false) {
  return await apiRequest({ action: 'getHistoryPageData', carId: carId, month: month }, 'GET', null, silent);
}

// ==========================================
// MOCK LOCALSTORAGE DATABASE BACKEND
// ==========================================

function initMockDatabase() {
  const getOrSet = (key, defaultVal) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(defaultVal));
    }
  };
  
  getOrSet('mock_fuel', [
    {
      record_id: 'MOCK-FL-1',
      timestamp: new Date().toISOString(),
      user_name: 'คุณนพ',
      car_id: 1,
      date: '2026-06-20',
      odometer_km: 90200,
      fuel_type: '95',
      liters: 30,
      price_per_liter: 38.5,
      total_cost: 1155,
      station: 'ปตท. วิภาวดี',
      efficiency_km_per_liter: '14.50'
    },
    {
      record_id: 'MOCK-FL-2',
      timestamp: new Date().toISOString(),
      user_name: 'แฟน',
      car_id: 1,
      date: '2026-06-24',
      odometer_km: 90590,
      fuel_type: '95',
      liters: 28,
      price_per_liter: 38.7,
      total_cost: 1083.6,
      station: 'บางจาก ลาดพร้าว',
      efficiency_km_per_liter: '13.93' // (90590 - 90200) / 28
    },
    {
      record_id: 'MOCK-FL-3',
      timestamp: new Date().toISOString(),
      user_name: 'คุณนพ',
      car_id: 2,
      date: '2026-06-15',
      odometer_km: 154200,
      fuel_type: 'E20',
      liters: 32,
      price_per_liter: 34.2,
      total_cost: 1094.4,
      station: 'Shell รัชดา',
      efficiency_km_per_liter: '11.80'
    }
  ]);
  
  getOrSet('mock_maintenance', [
    {
      record_id: 'MOCK-MT-1',
      timestamp: new Date().toISOString(),
      user_name: 'คุณนพ',
      car_id: 1,
      date: '2026-06-10',
      time: '14:30',
      odometer_km: 90150,
      shop_name: 'อู่ช่างใหญ่ รามอินทรา',
      total_cost: 1300,
      next_km: 100150,
      next_date: '2026-12-10',
      notes: 'เปลี่ยนถ่ายน้ำมันเครื่องตามระยะ แหวนรองไม่มีรั่วซึม'
    }
  ]);
  
  getOrSet('mock_maintenance_items', [
    { item_id: 'ITI-1', record_id: 'MOCK-MT-1', service_name: 'เปลี่ยนถ่ายน้ำมันเครื่อง', cost: 1000 },
    { item_id: 'ITI-2', record_id: 'MOCK-MT-1', service_name: 'ไส้กรองเครื่อง', cost: 300 }
  ]);
  
  getOrSet('mock_service_types', [
    'เปลี่ยนถ่ายน้ำมันเครื่อง', 'ไส้กรองเครื่อง', 'ไส้กรองแอร์', 'กรองอากาศ', 
    'ล้างรถ', 'ล้างแอร์', 'สลับยาง', 'ยางรถยนต์ใหม่', 'การตั้งศูนย์ล้อ', 
    'ผ้าเบรค', 'น้ำมันเกียร์', 'น้ำมันเบรค', 'แบตเตอรี่', 'หลอดไฟ', 'ค่าแรง'
  ]);
}

/**
 * Handle API calls by intercepting and routing to LocalStorage
 */
async function mockApiRequest(action, method, postData) {
  // Simulate network latency (200ms) for realistic feel
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const getStore = (key) => JSON.parse(localStorage.getItem(key));
  const saveStore = (key, data) => localStorage.setItem(key, JSON.stringify(data));
  
  let actionName = '';
  let params = {};
  
  if (method === 'GET') {
    actionName = action.action;
    params = action;
  } else {
    actionName = action.action;
    params = action;
  }
  
  switch (actionName) {
    case 'getFuel': {
      const fuels = getStore('mock_fuel');
      if (!params.carId) return fuels;
      return fuels.filter(r => String(r.car_id) === String(params.carId));
    }
    
    case 'addFuel': {
      const fuels = getStore('mock_fuel');
      const data = params.data;
      const recordId = 'MOCK-FL-' + new Date().getTime();
      
      // Calculate efficiency
      let efficiency = 0;
      if (data.odometer_km) {
        const prev = fuels.filter(r => String(r.car_id) === String(data.car_id));
        if (prev.length > 0) {
          const sorted = prev
            .filter(r => new Date(r.date) <= new Date(data.date))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
          if (sorted.length > 0) {
            const prevOdo = Number(sorted[0].odometer_km);
            const currentOdo = Number(data.odometer_km);
            if (currentOdo > prevOdo && Number(data.liters) > 0) {
              efficiency = (currentOdo - prevOdo) / Number(data.liters);
            }
          }
        }
      }
      
      const newRec = {
        record_id: recordId,
        timestamp: new Date().toISOString(),
        user_name: data.user_name || 'ผู้ใช้งาน',
        car_id: Number(data.car_id),
        date: data.date,
        odometer_km: Number(data.odometer_km),
        fuel_type: data.fuel_type,
        liters: Number(data.liters),
        price_per_liter: Number(data.price_per_liter),
        total_cost: Number(data.total_cost),
        station: data.station,
        efficiency_km_per_liter: efficiency.toFixed(2)
      };
      
      fuels.push(newRec);
      saveStore('mock_fuel', fuels);
      return { record_id: recordId };
    }
    
    case 'updateFuel': {
      const fuels = getStore('mock_fuel');
      const data = params.data;
      const idx = fuels.findIndex(r => r.record_id === params.id);
      if (idx === -1) throw new Error('Record not found');
      
      // Re-calculate efficiency
      let efficiency = 0;
      if (data.odometer_km) {
        const prev = fuels.filter(r => String(r.car_id) === String(data.car_id) && r.record_id !== params.id);
        if (prev.length > 0) {
          const sorted = prev
            .filter(r => new Date(r.date) <= new Date(data.date))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
          if (sorted.length > 0) {
            const prevOdo = Number(sorted[0].odometer_km);
            const currentOdo = Number(data.odometer_km);
            if (currentOdo > prevOdo && Number(data.liters) > 0) {
              efficiency = (currentOdo - prevOdo) / Number(data.liters);
            }
          }
        }
      }
      
      fuels[idx] = {
        ...fuels[idx],
        date: data.date,
        odometer_km: Number(data.odometer_km),
        fuel_type: data.fuel_type,
        liters: Number(data.liters),
        price_per_liter: Number(data.price_per_liter),
        total_cost: Number(data.total_cost),
        station: data.station,
        efficiency_km_per_liter: efficiency.toFixed(2)
      };
      
      saveStore('mock_fuel', fuels);
      return { success: true };
    }
    
    case 'getMaintenance': {
      const maints = getStore('mock_maintenance');
      const items = getStore('mock_maintenance_items');
      
      const filtered = params.carId 
        ? maints.filter(r => String(r.car_id) === String(params.carId))
        : maints;
        
      return filtered.map(m => {
        const sub = items.filter(item => item.record_id === m.record_id);
        m.items = sub.map(item => ({
          service_name: item.service_name,
          cost: item.cost
        }));
        return m;
      });
    }
    
    case 'getMaintenanceItems': {
      const items = getStore('mock_maintenance_items');
      return items.filter(r => r.record_id === params.recordId);
    }
    
    case 'addMaintenance': {
      const maints = getStore('mock_maintenance');
      const items = getStore('mock_maintenance_items');
      const data = params.data;
      const recordId = 'MOCK-MT-' + new Date().getTime();
      
      const newRec = {
        record_id: recordId,
        timestamp: new Date().toISOString(),
        user_name: data.user_name || 'ผู้ใช้งาน',
        car_id: Number(data.car_id),
        date: data.date,
        time: data.time || '12:00',
        odometer_km: Number(data.odometer_km),
        shop_name: data.shop_name,
        total_cost: Number(data.total_cost),
        next_km: data.next_km ? Number(data.next_km) : '',
        next_date: data.next_date || '',
        notes: data.notes || ''
      };
      
      maints.push(newRec);
      saveStore('mock_maintenance', maints);
      
      // Save items
      if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
          items.push({
            item_id: 'MOCK-ITI-' + Math.floor(Math.random() * 10000),
            record_id: recordId,
            service_name: item.service_name,
            cost: Number(item.cost)
          });
        });
        saveStore('mock_maintenance_items', items);
      }
      return { record_id: recordId };
    }
    
    case 'updateMaintenance': {
      const maints = getStore('mock_maintenance');
      let items = getStore('mock_maintenance_items');
      const data = params.data;
      const idx = maints.findIndex(r => r.record_id === params.id);
      if (idx === -1) throw new Error('Record not found');
      
      // Update main
      maints[idx] = {
        ...maints[idx],
        date: data.date,
        time: data.time || '12:00',
        odometer_km: Number(data.odometer_km),
        shop_name: data.shop_name,
        total_cost: Number(data.total_cost),
        next_km: data.next_km ? Number(data.next_km) : '',
        next_date: data.next_date || '',
        notes: data.notes || ''
      };
      saveStore('mock_maintenance', maints);
      
      // Remove old items
      items = items.filter(item => item.record_id !== params.id);
      
      // Insert new
      if (data.items && data.items.length > 0) {
        data.items.forEach(item => {
          items.push({
            item_id: 'MOCK-ITI-' + Math.floor(Math.random() * 10000),
            record_id: params.id,
            service_name: item.service_name,
            cost: Number(item.cost)
          });
        });
      }
      saveStore('mock_maintenance_items', items);
      return { success: true };
    }
    
    case 'deleteRecord': {
      if (params.type === 'fuel') {
        let fuels = getStore('mock_fuel');
        fuels = fuels.filter(r => r.record_id !== params.id);
        saveStore('mock_fuel', fuels);
        return { success: true };
      } else {
        let maints = getStore('mock_maintenance');
        let items = getStore('mock_maintenance_items');
        maints = maints.filter(r => r.record_id !== params.id);
        items = items.filter(r => r.record_id !== params.id);
        saveStore('mock_maintenance', maints);
        saveStore('mock_maintenance_items', items);
        return { success: true };
      }
    }
    
    case 'getServiceTypes': {
      return getStore('mock_service_types');
    }
    
    case 'addServiceType': {
      const types = getStore('mock_service_types');
      const name = params.data.service_name;
      if (!types.includes(name)) {
        types.push(name);
        saveStore('mock_service_types', types);
      }
      return { success: true };
    }
    
    case 'deleteServiceType': {
      let types = getStore('mock_service_types');
      const name = params.data.service_name;
      types = types.filter(t => t !== name);
      saveStore('mock_service_types', types);
      return { success: true };
    }
    
    case 'getSummary': {
      const fuels = getStore('mock_fuel').filter(r => String(r.car_id) === String(params.carId));
      const maints = getStore('mock_maintenance').filter(r => String(r.car_id) === String(params.carId));
      const month = params.month; // YYYY-MM
      
      const filterByMonth = (dStr) => dStr && dStr.substring(0, 7) === month;
      
      const currentMonthFuels = fuels.filter(r => filterByMonth(r.date));
      const currentMonthMaints = maints.filter(r => filterByMonth(r.date));
      
      const totalFuelCost = currentMonthFuels.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
      
      const fuelsWithEff = currentMonthFuels.filter(r => Number(r.efficiency_km_per_liter || 0) > 0);
      const avgEff = fuelsWithEff.length > 0
        ? (fuelsWithEff.reduce((sum, r) => sum + Number(r.efficiency_km_per_liter), 0) / fuelsWithEff.length)
        : 0;
        
      const totalMaintCost = currentMonthMaints.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
      
      // Calculate 6-month trends
      const trends = {};
      const today = new Date();
      const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const mStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        trends[mStr] = {
          month: mStr,
          label: monthNames[d.getMonth()] + ' ' + String(d.getFullYear() + 543).substring(2),
          fuel: 0,
          maintenance: 0
        };
      }
      
      fuels.forEach(r => {
        const mStr = r.date.substring(0, 7);
        if (trends[mStr]) trends[mStr].fuel += Number(r.total_cost || 0);
      });
      
      maints.forEach(r => {
        const mStr = r.date.substring(0, 7);
        if (trends[mStr]) trends[mStr].maintenance += Number(r.total_cost || 0);
      });
      
      const chartArr = Object.keys(trends).sort().map(key => trends[key]);
      
      return {
        month: month,
        total_fuel_cost: totalFuelCost,
        average_efficiency: Number(avgEff.toFixed(2)),
        total_maintenance_cost: totalMaintCost,
        chart: chartArr
      };
    }
    
    case 'getHistoryPageData': {
      const summary = await mockApiRequest({ action: 'getSummary', carId: params.carId, month: params.month }, 'GET');
      const fuel = await mockApiRequest({ action: 'getFuel', carId: params.carId }, 'GET');
      const maintenance = await mockApiRequest({ action: 'getMaintenance', carId: params.carId }, 'GET');
      return {
        summary: summary,
        fuel: fuel,
        maintenance: maintenance
      };
    }
    
    default:
      throw new Error('Mock action not implemented: ' + actionName);
  }
}
