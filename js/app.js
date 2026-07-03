/**
 * CAR TRACKER - SHARED APP UTILITIES & PROFILE CONFIG
 */

// 1. CAR CONFIGURATION
const CARS = [
  { id: 1, name: 'Nissan Almera', year: 2020, color: 'ส้ม', plate: '9กข 70' },
  { id: 2, name: 'Honda Jazz', year: 2014, color: 'เหลือง', plate: '3กส 7666' }
];

// 2. PROFILE CONFIGURATION (ผู้ใช้งานในครอบครัว — เลือกครั้งเดียว จำไว้ในเครื่อง)
const PROFILES = [
  { id: 'liang', name: 'Liang', img: 'Files/M.png' },
  { id: 'koy',   name: 'Koy',   img: 'Files/FM.png' }
];

const PROFILE_STORAGE_KEY = 'car_tracker_profile';

/**
 * คืน markup รูปโปรไฟล์ (วางในวงกลมพื้นอ่อนที่กำหนดใน CSS)
 */
function profileAvatarHTML(profile) {
  return `<img src="${profile.img}" alt="${profile.name}">`;
}

// 3. GLOBAL STATE
let activeCar = null;
let currentProfile = null;
let currentUser = {
  displayName: 'ผู้ใช้งาน'
};

/**
 * Per-profile localStorage key for the last-used car
 */
function activeCarStorageKey() {
  const pid = currentProfile ? currentProfile.id : 'default';
  return 'car_tracker_active_car_' + pid;
}

/**
 * Apply a profile to global state
 */
function applyProfile(profileId) {
  currentProfile = PROFILES.find(p => p.id === profileId) || PROFILES[0];
  currentUser = { displayName: currentProfile.name };
}

/**
 * Ensure a profile is selected. If none stored, show the picker and block
 * until the user chooses. Calls callback once a profile is active.
 */
function ensureProfile(callback) {
  const storedId = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (storedId && PROFILES.find(p => p.id === storedId)) {
    applyProfile(storedId);
    if (typeof callback === 'function') callback();
  } else {
    renderProfilePicker((pickedId) => {
      localStorage.setItem(PROFILE_STORAGE_KEY, pickedId);
      applyProfile(pickedId);
      if (typeof callback === 'function') callback();
    }, false);
  }
}

/**
 * Switch profile: show the picker (cancellable). On pick, reload so all
 * data reflects the new person's last-used car.
 */
function switchProfile() {
  renderProfilePicker((pickedId) => {
    localStorage.setItem(PROFILE_STORAGE_KEY, pickedId);
    location.reload();
  }, true);
}

/**
 * Render the full-screen "who is using this?" profile picker overlay
 * @param {function} onPick - called with the chosen profile id
 * @param {boolean} allowCancel - show a cancel button (for switching)
 */
function renderProfilePicker(onPick, allowCancel) {
  const existing = document.getElementById('profile-picker');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'profile-picker';
  overlay.className = 'profile-picker-overlay';
  overlay.innerHTML = `
    <div class="profile-picker-inner">
      <div class="profile-picker-heading">
        <div class="profile-picker-logo">🚗</div>
        <div class="profile-picker-title">ใครกำลังใช้งาน?</div>
      </div>
      <div class="profile-picker-grid">
        ${PROFILES.map(p => `
          <button type="button" class="profile-card" data-id="${p.id}">
            <span class="profile-card-avatar">${profileAvatarHTML(p)}</span>
            <span class="profile-card-name">${p.name}</span>
          </button>
        `).join('')}
      </div>
      ${allowCancel ? '<button type="button" class="profile-picker-cancel" id="profile-picker-cancel">ยกเลิก</button>' : ''}
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.profile-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      overlay.remove();
      if (typeof onPick === 'function') onPick(id);
    });
  });

  if (allowCancel) {
    overlay.querySelector('#profile-picker-cancel').addEventListener('click', () => overlay.remove());
  }
}

/**
 * Initialize App Core
 * @param {string} pageType - 'fuel', 'maintenance', or 'history'
 * @param {function} onReadyCallback - Called when profile and car toggle are ready
 */
function initApp(pageType, onReadyCallback) {
  // Set up theme class on body
  document.body.classList.add(`theme-${pageType}`);

  // Set up Loading State handlers
  setupLoadingElements();

  // Ensure a profile is selected (shows picker on first launch), then init
  ensureProfile(() => {
    // Initialize Active Car (per-profile last-used car)
    initActiveCar();

    // Render Car Toggle Switch in Header
    renderCarToggle(onReadyCallback);

    // Render User Profile Badge in header if element exists
    renderUserBadge();

    // Call page specific initialization
    if (typeof onReadyCallback === 'function') {
      onReadyCallback();
    }
  });
}

/**
 * Handle Active Car State (load from localStorage)
 */
function initActiveCar() {
  const savedCarId = localStorage.getItem(activeCarStorageKey());
  if (savedCarId) {
    activeCar = CARS.find(car => car.id === Number(savedCarId)) || CARS[0];
  } else {
    activeCar = CARS[0];
    localStorage.setItem(activeCarStorageKey(), activeCar.id);
  }
}

/**
 * Render Car Toggle Switch in Header
 */
function renderCarToggle(onReadyCallback) {
  const container = document.querySelector('.car-toggle-container');
  if (!container) return;
  
  container.innerHTML = CARS.map(car => `
    <button type="button" class="car-toggle-btn car-id-${car.id} ${activeCar.id === car.id ? 'active' : ''}" data-car-id="${car.id}">
      <span class="name">${car.name}</span>
      <span class="plate">${car.plate}</span>
    </button>
  `).join('');
  
  // Add Event Listeners
  container.querySelectorAll('.car-toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const carId = Number(this.getAttribute('data-car-id'));
      if (activeCar.id === carId) return;
      
      // Update UI active state
      container.querySelectorAll('.car-toggle-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      // Update State & LocalStorage (per-profile last-used car)
      activeCar = CARS.find(car => car.id === carId);
      localStorage.setItem(activeCarStorageKey(), activeCar.id);
      
      // Trigger callback if defined (e.g. reload charts/lists on active car change)
      if (typeof onReadyCallback === 'function') {
        onReadyCallback();
      }
    });
  });
}

/**
 * Render User Profile Badge
 */
function renderUserBadge() {
  const container = document.querySelector('.user-badge');
  if (!container || !currentProfile) return;

  container.classList.add('user-badge-clickable');
  container.innerHTML = `
    <span class="user-badge-avatar">${profileAvatarHTML(currentProfile)}</span>
    <span>${currentProfile.name}</span>
    <i class="fa-solid fa-angle-down user-badge-caret"></i>
  `;
  container.setAttribute('title', 'แตะเพื่อสลับผู้ใช้');
  container.onclick = switchProfile;
}

// ==========================================
// LOADING STATE HANDLERS
// ==========================================
function setupLoadingElements() {
  if (document.querySelector('.loading-overlay')) return;
  
  const loader = document.createElement('div');
  loader.className = 'loading-overlay';
  loader.innerHTML = `
    <div class="spinner"></div>
    <div class="loading-text">กำลังโหลดข้อมูล...</div>
  `;
  document.body.appendChild(loader);
}

function showLoading(text) {
  const loader = document.querySelector('.loading-overlay');
  if (loader) {
    if (text) {
      loader.querySelector('.loading-text').textContent = text;
    } else {
      loader.querySelector('.loading-text').textContent = 'กำลังโหลดข้อมูล...';
    }
    loader.classList.add('active');
  }
}

function hideLoading() {
  const loader = document.querySelector('.loading-overlay');
  if (loader) {
    loader.classList.remove('active');
  }
}

// ==========================================
// HELPER UTILITIES
// ==========================================

/**
 * Format number to currency style (e.g., 1000.5 -> ฿1,000.50)
 */
function formatCurrency(value) {
  if (value === undefined || value === null || isNaN(value)) return '฿0.00';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB'
  }).format(value);
}

/**
 * Format date string to display style (dd/mm/yyyy)
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear() + 543; // convert to Thai Buddhist era
  return `${d}/${m}/${y}`;
}

/**
 * Format date-time for display
 */
function formatDateTime(dateStr, timeStr) {
  if (!dateStr) return '-';
  let formatted = formatDate(dateStr);
  if (timeStr) {
    formatted += ` ${timeStr}`;
  }
  return formatted;
}

/**
 * Get current local date in YYYY-MM-DD format (for input[type=date])
 */
function getTodayDateString() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get current local time in HH:MM format
 */
function getCurrentTimeString() {
  const today = new Date();
  const h = String(today.getHours()).padStart(2, '0');
  const m = String(today.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Retrieve Query parameters from URL
 */
function getUrlParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}
