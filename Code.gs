/**
 * CAR TRACKER GOOGLE APPS SCRIPT API
 * 
 * Instructions:
 * 1. Open Google Sheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Replace the code in Code.gs with this file's content.
 * 4. Deploy as a Web App:
 *    - Click "Deploy" > "New deployment"
 *    - Select type "Web app"
 *    - Set "Execute as": "Me (your-email@gmail.com)"
 *    - Set "Who has access": "Anyone"
 *    - Deploy and copy the Web App URL for js/api.js
 */

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  const action = e.parameter.action;
  const carId = e.parameter.carId;
  
  let result = {};
  
  try {
    switch (action) {
      case 'getFuel':
        result = { success: true, data: getFuelRecords(carId) };
        break;
      case 'getMaintenance':
        result = { success: true, data: getMaintenanceRecords(carId) };
        break;
      case 'getMaintenanceItems':
        const recordId = e.parameter.recordId;
        result = { success: true, data: getMaintenanceItems(recordId) };
        break;
      case 'getServiceTypes':
        result = { success: true, data: getServiceTypes() };
        break;
      case 'getSummary':
        const month = e.parameter.month; // YYYY-MM
        result = { success: true, data: getDashboardSummary(carId, month) };
        break;
      case 'getHistoryPageData':
        const summaryMonth = e.parameter.month;
        result = {
          success: true,
          data: getHistoryPageData(carId, summaryMonth)
        };
        break;
      case 'getCarPass':
        const syncInfo = syncCarWalletPass(carId || '1');
        result = {
          success: true,
          data: {
            status: syncInfo.status,
            saveUrl: syncInfo.saveUrl
          }
        };
        break;
      default:
        result = { success: false, error: 'Invalid action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result = {};
  
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const data = postData.data;
    
    switch (action) {
      case 'addFuel':
        result = { success: true, data: addFuelRecord(data) };
        try { checkAndNotifyCarPass(data.car_id); } catch (e) {}
        break;
      case 'updateFuel':
        result = { success: true, data: updateFuelRecord(postData.id, data) };
        try { checkAndNotifyCarPass(data.car_id); } catch (e) {}
        break;
      case 'addMaintenance':
        result = { success: true, data: addMaintenanceRecord(data) };
        try { checkAndNotifyCarPass(data.car_id); } catch (e) {}
        break;
      case 'updateMaintenance':
        result = { success: true, data: updateMaintenanceRecord(postData.id, data) };
        try { checkAndNotifyCarPass(data.car_id); } catch (e) {}
        break;
      case 'deleteRecord':
        result = { success: true, data: deleteRecord(postData.type, postData.id) };
        try { syncAllCarWalletPasses(); } catch (e) {}
        break;
      case 'addServiceType':
        result = { success: true, data: addServiceType(data.service_name) };
        break;
      case 'deleteServiceType':
        result = { success: true, data: deleteServiceType(data.service_name) };
        break;
      case 'updateCarPassConfig':
        result = { success: true, data: updateCarPassConfig(postData.carId || '1', data || {}) };
        break;
      case 'snoozeCarPass':
        result = { success: true, data: snoozeCarPassAlert(postData.carId || '1', postData.daysOrDate) };
        break;
      case 'syncAllCarPasses':
        try { installDailyCarPassTrigger(); } catch (e) {}
        result = { success: true, data: syncAllCarWalletPasses() };
        break;
      default:
        result = { success: false, error: 'Invalid POST action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// CORE SHEET UTILITIES
// ==========================================

function getSheetByName(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    setupSheetHeaders(sheet, name);
  }
  return sheet;
}

function setupSheetHeaders(sheet, name) {
  const headers = {
    'fuel_records': ['record_id', 'timestamp', 'user_name', 'car_id', 'date', 'odometer_km', 'fuel_type', 'liters', 'price_per_liter', 'total_cost', 'station', 'efficiency_km_per_liter'],
    'maintenance_records': ['record_id', 'timestamp', 'user_name', 'car_id', 'date', 'time', 'odometer_km', 'shop_name', 'total_cost', 'next_km', 'next_date', 'notes'],
    'maintenance_items': ['item_id', 'record_id', 'service_name', 'cost'],
    'service_types': ['service_name', 'is_active'],
    'cars': ['car_id', 'car_name', 'year', 'color', 'license_plate']
  };
  
  if (headers[name]) {
    sheet.appendRow(headers[name]);
    sheet.getRange(1, 1, 1, headers[name].length).setFontWeight("bold").setBackground("#eaeaea");
    
    // Add default cars if sheet is cars
    if (name === 'cars') {
      sheet.appendRow(['1', 'Nissan Almera', '2020', 'ส้ม', '9กข 70']);
      sheet.appendRow(['2', 'Honda Jazz', '2014', 'เหลือง', '3กส 7666']);
    }
    
    // Add default service types if sheet is service_types
    if (name === 'service_types') {
      const defaults = [
        'เปลี่ยนถ่ายน้ำมันเครื่อง', 'ไส้กรองเครื่อง', 'ไส้กรองแอร์', 'กรองอากาศ', 
        'ล้างรถ', 'ล้างแอร์', 'สลับยาง', 'ยางรถยนต์ใหม่', 'การตั้งศูนย์ล้อ', 
        'ผ้าเบรค', 'น้ำมันเกียร์', 'น้ำมันเบรค', 'แบตเตอรี่', 'หลอดไฟ', 'ค่าแรง'
      ];
      defaults.forEach(service => {
        sheet.appendRow([service, 'TRUE']);
      });
    }
  }
}

function generateUUID() {
  return Utilities.getUuid();
}

function getRowsData(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    row._rowNum = i + 1; // 1-indexed row number in sheet
    rows.push(row);
  }
  return rows;
}

// ==========================================
// FUEL ACTIONS
// ==========================================

function getFuelRecords(carId) {
  const sheet = getSheetByName('fuel_records');
  const rows = getRowsData(sheet);
  if (!carId || carId === 'undefined' || carId === 'null') return rows;
  return rows.filter(row => String(row.car_id) === String(carId));
}

function addFuelRecord(data) {
  const sheet = getSheetByName('fuel_records');
  const recordId = 'FL-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  
  // Calculate fuel efficiency if odometer is provided
  let efficiency = 0;
  if (data.odometer_km) {
    const prevRecords = getFuelRecords(data.car_id);
    if (prevRecords.length > 0) {
      // Find latest record before current date
      const sorted = prevRecords
        .filter(r => new Date(r.date) <= new Date(data.date))
        .sort((a, b) => new Date(b.date) - new Date(a.date) || b.odometer_km - a.odometer_km);
      
      if (sorted.length > 0) {
        const prevOdo = Number(sorted[0].odometer_km);
        const currentOdo = Number(data.odometer_km);
        if (currentOdo > prevOdo && Number(data.liters) > 0) {
          efficiency = (currentOdo - prevOdo) / Number(data.liters);
        }
      }
    }
  }

  const row = [
    recordId,
    new Date(),
    data.user_name || 'ผู้ใช้งาน',
    data.car_id,
    data.date,
    data.odometer_km,
    data.fuel_type,
    data.liters,
    data.price_per_liter,
    data.total_cost,
    data.station,
    efficiency.toFixed(2)
  ];
  
  sheet.appendRow(row);
  return { record_id: recordId };
}

function updateFuelRecord(id, data) {
  const sheet = getSheetByName('fuel_records');
  const rows = getRowsData(sheet);
  const targetRow = rows.find(row => row.record_id === id);
  
  if (!targetRow) throw new Error('Record not found');
  
  // Re-calculate efficiency
  let efficiency = 0;
  if (data.odometer_km) {
    const prevRecords = getFuelRecords(data.car_id).filter(r => r.record_id !== id);
    if (prevRecords.length > 0) {
      const sorted = prevRecords
        .filter(r => new Date(r.date) <= new Date(data.date))
        .sort((a, b) => new Date(b.date) - new Date(a.date) || b.odometer_km - a.odometer_km);
      
      if (sorted.length > 0) {
        const prevOdo = Number(sorted[0].odometer_km);
        const currentOdo = Number(data.odometer_km);
        if (currentOdo > prevOdo && Number(data.liters) > 0) {
          efficiency = (currentOdo - prevOdo) / Number(data.liters);
        }
      }
    }
  }

  // Update row in sheet (headers match indices)
  const headers = sheet.getDataRange().getValues()[0];
  const updateData = {
    car_id: data.car_id,
    date: data.date,
    odometer_km: data.odometer_km,
    fuel_type: data.fuel_type,
    liters: data.liters,
    price_per_liter: data.price_per_liter,
    total_cost: data.total_cost,
    station: data.station,
    efficiency_km_per_liter: efficiency.toFixed(2)
  };
  
  for (let j = 0; j < headers.length; j++) {
    const key = headers[j];
    if (updateData[key] !== undefined) {
      sheet.getRange(targetRow._rowNum, j + 1).setValue(updateData[key]);
    }
  }
  
  return { success: true };
}

// ==========================================
// MAINTENANCE ACTIONS
// ==========================================

function getMaintenanceRecords(carId) {
  const mainSheet = getSheetByName('maintenance_records');
  const mainRows = getRowsData(mainSheet);
  
  const itemSheet = getSheetByName('maintenance_items');
  const itemRows = getRowsData(itemSheet);
  
  const filteredMain = (!carId || carId === 'undefined' || carId === 'null') 
    ? mainRows
    : mainRows.filter(row => String(row.car_id) === String(carId));
    
  return filteredMain.map(mainRec => {
    const subItems = itemRows.filter(item => item.record_id === mainRec.record_id);
    mainRec.items = subItems.map(item => ({
      service_name: item.service_name,
      cost: item.cost
    }));
    return mainRec;
  });
}

function getMaintenanceItems(recordId) {
  const sheet = getSheetByName('maintenance_items');
  const rows = getRowsData(sheet);
  if (!recordId) return rows;
  return rows.filter(row => String(row.record_id) === String(recordId));
}

function addMaintenanceRecord(data) {
  const mainSheet = getSheetByName('maintenance_records');
  const itemSheet = getSheetByName('maintenance_items');
  
  const recordId = 'MT-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  
  // 1. Save main record
  const mainRow = [
    recordId,
    new Date(),
    data.user_name || 'ผู้ใช้งาน',
    data.car_id,
    data.date,
    data.time || '12:00',
    data.odometer_km,
    data.shop_name,
    data.total_cost,
    data.next_km || '',
    data.next_date || '',
    data.notes || ''
  ];
  mainSheet.appendRow(mainRow);
  
  // 2. Save items detail
  if (data.items && data.items.length > 0) {
    data.items.forEach(item => {
      const itemId = 'ITI-' + generateUUID().substring(0, 8);
      itemSheet.appendRow([
        itemId,
        recordId,
        item.service_name,
        item.cost
      ]);
    });
  }
  
  return { record_id: recordId };
}

function updateMaintenanceRecord(id, data) {
  const mainSheet = getSheetByName('maintenance_records');
  const itemSheet = getSheetByName('maintenance_items');
  
  // Find main record
  const mainRows = getRowsData(mainSheet);
  const targetRow = mainRows.find(row => row.record_id === id);
  if (!targetRow) throw new Error('Maintenance record not found');
  
  // 1. Update main record in sheet
  const headers = mainSheet.getDataRange().getValues()[0];
  const updateData = {
    car_id: data.car_id,
    date: data.date,
    time: data.time || '12:00',
    odometer_km: data.odometer_km,
    shop_name: data.shop_name,
    total_cost: data.total_cost,
    next_km: data.next_km || '',
    next_date: data.next_date || '',
    notes: data.notes || ''
  };
  
  for (let j = 0; j < headers.length; j++) {
    const key = headers[j];
    if (updateData[key] !== undefined) {
      mainSheet.getRange(targetRow._rowNum, j + 1).setValue(updateData[key]);
    }
  }
  
  // 2. Remove old items details
  const itemRows = getRowsData(itemSheet);
  const oldItems = itemRows.filter(row => row.record_id === id);
  
  // Delete rows from sheet in reverse order to keep correct row numbers
  oldItems.sort((a, b) => b._rowNum - a._rowNum).forEach(item => {
    itemSheet.deleteRow(item._rowNum);
  });
  
  // 3. Insert new items details
  if (data.items && data.items.length > 0) {
    data.items.forEach(item => {
      const itemId = 'ITI-' + generateUUID().substring(0, 8);
      itemSheet.appendRow([
        itemId,
        id,
        item.service_name,
        item.cost
      ]);
    });
  }
  
  return { success: true };
}

// ==========================================
// DELETE ACTIONS
// ==========================================

function deleteRecord(type, id) {
  if (type === 'fuel') {
    const sheet = getSheetByName('fuel_records');
    const rows = getRowsData(sheet);
    const target = rows.find(row => row.record_id === id);
    if (target) {
      sheet.deleteRow(target._rowNum);
      return { success: true };
    }
  } else if (type === 'maintenance') {
    const mainSheet = getSheetByName('maintenance_records');
    const itemSheet = getSheetByName('maintenance_items');
    
    // Delete main record
    const mainRows = getRowsData(mainSheet);
    const targetMain = mainRows.find(row => row.record_id === id);
    if (targetMain) {
      mainSheet.deleteRow(targetMain._rowNum);
    }
    
    // Delete sub items
    const itemRows = getRowsData(itemSheet);
    const targetItems = itemRows.filter(row => row.record_id === id);
    targetItems.sort((a, b) => b._rowNum - a._rowNum).forEach(item => {
      itemSheet.deleteRow(item._rowNum);
    });
    
    return { success: true };
  }
  throw new Error('Record not found or invalid type');
}

// ==========================================
// SERVICE TYPES MANAGEMENT
// ==========================================

function getServiceTypes() {
  const sheet = getSheetByName('service_types');
  const rows = getRowsData(sheet);
  return rows.filter(row => String(row.is_active).toUpperCase() === 'TRUE').map(row => row.service_name);
}

function addServiceType(name) {
  const sheet = getSheetByName('service_types');
  const rows = getRowsData(sheet);
  const exists = rows.find(row => String(row.service_name).trim().toLowerCase() === String(name).trim().toLowerCase());
  
  if (exists) {
    if (String(exists.is_active).toUpperCase() === 'FALSE') {
      // Re-activate
      sheet.getRange(exists._rowNum, 2).setValue('TRUE');
    }
  } else {
    sheet.appendRow([name, 'TRUE']);
  }
  return { success: true };
}

function deleteServiceType(name) {
  const sheet = getSheetByName('service_types');
  const rows = getRowsData(sheet);
  const target = rows.find(row => String(row.service_name).trim().toLowerCase() === String(name).trim().toLowerCase());
  
  if (target) {
    // Soft delete by setting is_active to FALSE
    sheet.getRange(target._rowNum, 2).setValue('FALSE');
  }
  return { success: true };
}

// ==========================================
// DASHBOARD & SUMMARY
// ==========================================

function getDashboardSummary(carId, month) {
  if (!month) {
    const today = new Date();
    month = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  }
  
  const fuelRecords = getFuelRecords(carId);
  const mRecords = getMaintenanceRecords(carId);
  
  // Filter by month (dates in Sheets are Date objects or ISO strings)
  const filterByMonth = (recordDateStr) => {
    if (!recordDateStr) return false;
    const dateObj = new Date(recordDateStr);
    if (isNaN(dateObj.getTime())) return false;
    const yearMonth = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
    return yearMonth === month;
  };
  
  const currentMonthFuels = fuelRecords.filter(r => filterByMonth(r.date));
  const currentMonthMaintenances = mRecords.filter(r => filterByMonth(r.date));
  
  // 1. Calculate Monthly Fuel Cost
  const totalFuelCost = currentMonthFuels.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
  
  // 2. Calculate Monthly Average Fuel Efficiency (km/L)
  const fuelsWithEfficiency = currentMonthFuels.filter(r => Number(r.efficiency_km_per_liter || 0) > 0);
  const avgEfficiency = fuelsWithEfficiency.length > 0 
    ? (fuelsWithEfficiency.reduce((sum, r) => sum + Number(r.efficiency_km_per_liter), 0) / fuelsWithEfficiency.length)
    : 0;
  
  // 3. Calculate Monthly Maintenance Cost
  const totalMaintenanceCost = currentMonthMaintenances.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
  
  // 4. Generate data for Chart (last 6 months trend)
  const chartData = getMonthlyTrendData(fuelRecords, mRecords);
  
  return {
    month: month,
    total_fuel_cost: totalFuelCost,
    average_efficiency: Number(avgEfficiency.toFixed(2)),
    total_maintenance_cost: totalMaintenanceCost,
    chart: chartData
  };
}

function getMonthlyTrendData(fuelRecords, mRecords) {
  const trends = {};
  const today = new Date();
  
  // Initialize last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const mStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    trends[mStr] = { month: mStr, label: getMonthLabelTh(d.getMonth()) + ' ' + String(d.getFullYear() + 543).substring(2), fuel: 0, maintenance: 0 };
  }
  
  // Aggregate Fuel
  fuelRecords.forEach(r => {
    if (!r.date) return;
    const dateObj = new Date(r.date);
    if (isNaN(dateObj.getTime())) return;
    const mStr = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
    if (trends[mStr]) {
      trends[mStr].fuel += Number(r.total_cost || 0);
    }
  });
  
  // Aggregate Maintenance
  mRecords.forEach(r => {
    if (!r.date) return;
    const dateObj = new Date(r.date);
    if (isNaN(dateObj.getTime())) return;
    const mStr = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
    if (trends[mStr]) {
      trends[mStr].maintenance += Number(r.total_cost || 0);
    }
  });
  
  // Convert to sorted array
  return Object.keys(trends).sort().map(key => trends[key]);
}

function getMonthLabelTh(monthIndex) {
  const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return monthNames[monthIndex];
}

function getHistoryPageData(carId, month) {
  if (!month) {
    const today = new Date();
    month = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  }
  
  // 1. Fetch from sheet ONCE!
  const fuelRecords = getFuelRecords(carId);
  const mRecords = getMaintenanceRecords(carId);
  
  // 2. Filter by month for dashboard stats
  const filterByMonth = (recordDateStr) => {
    if (!recordDateStr) return false;
    const dateObj = new Date(recordDateStr);
    if (isNaN(dateObj.getTime())) return false;
    const yearMonth = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
    return yearMonth === month;
  };
  
  const currentMonthFuels = fuelRecords.filter(r => filterByMonth(r.date));
  const currentMonthMaintenances = mRecords.filter(r => filterByMonth(r.date));
  
  const totalFuelCost = currentMonthFuels.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
  
  const fuelsWithEfficiency = currentMonthFuels.filter(r => Number(r.efficiency_km_per_liter || 0) > 0);
  const avgEfficiency = fuelsWithEfficiency.length > 0 
    ? (fuelsWithEfficiency.reduce((sum, r) => sum + Number(r.efficiency_km_per_liter), 0) / fuelsWithEfficiency.length)
    : 0;
  
  const totalMaintenanceCost = currentMonthMaintenances.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
  
  // Calculate 6-month trends (uses the same fuelRecords and mRecords)
  const chartData = getMonthlyTrendData(fuelRecords, mRecords);
  
  const summary = {
    month: month,
    total_fuel_cost: totalFuelCost,
    average_efficiency: Number(avgEfficiency.toFixed(2)),
    total_maintenance_cost: totalMaintenanceCost,
    chart: chartData
  };
  
  return {
    summary: summary,
    fuel: fuelRecords,
    maintenance: mRecords
  };
}
