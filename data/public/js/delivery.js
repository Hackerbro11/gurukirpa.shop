// Guru Kirpa Fast Food - Delivery Partner / Rider Logic
let activeRider = JSON.parse(localStorage.getItem('gk_active_rider') || 'null');
let deliveryOrders = [];
let gpsWatchId = null;
let currentCoords = { lat: 30.9010, lng: 75.8573 }; // Default restaurant coords
let isSimulatingGPS = false;
let simulationInterval = null;
let deferredPrompt = null;

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/delivery-sw.js')
      .then(reg => console.log('Delivery PWA Service Worker registered:', reg.scope))
      .catch(err => console.warn('PWA SW error:', err));
  });
}

// Capture Android PWA install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('PWA installation prompt available');
});

async function triggerPwaInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      alert('✓ Guru Kirpa Delivery Partner App installed on your phone home screen!');
    }
    deferredPrompt = null;
  } else {
    const modal = document.getElementById('pwa-install-guide-modal');
    if (modal) modal.classList.remove('hidden');
  }
}

function closeInstallGuide() {
  const modal = document.getElementById('pwa-install-guide-modal');
  if (modal) modal.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  fetchRidersList();

  if (activeRider) {
    unlockRiderUI();
  } else {
    document.getElementById('rider-login-modal').classList.remove('hidden');
  }
});

// Fetch riders for login dropdown
async function fetchRidersList() {
  try {
    const res = await fetch('/api/riders');
    const riders = await res.json();
    const select = document.getElementById('rider-select');
    if (select) {
      select.innerHTML = riders.map(r => `
        <option value="${r.id}">${r.name} (${r.vehicle})</option>
      `).join('');
    }
  } catch (e) {
    console.error('Failed to load riders list:', e);
  }
}

// Helper for authenticated rider API requests
function riderFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (activeRider) {
    if (activeRider.pin) headers['X-Rider-PIN'] = activeRider.pin;
    if (activeRider.id) headers['X-Rider-ID'] = activeRider.id;
  }
  return fetch(url, { ...options, headers });
}

// Rider Login
async function loginRider() {
  const riderId = document.getElementById('rider-select').value;
  const pin = document.getElementById('rider-pin-input').value.trim();
  const errorEl = document.getElementById('rider-login-error');

  try {
    const res = await fetch('/api/riders/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId, pin })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      activeRider = data.rider;
      activeRider.pin = pin; // Persist session PIN locally
      localStorage.setItem('gk_active_rider', JSON.stringify(activeRider));
      unlockRiderUI();
    } else {
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.classList.remove('hidden');
  }
}

function unlockRiderUI() {
  document.getElementById('rider-login-modal').classList.add('hidden');
  document.getElementById('active-rider-name').textContent = activeRider.name + ' 🛵';
  fetchDeliveryOrders();
  startLiveGPS();
  initDeliverySSE();
}

function logoutRider() {
  if (confirm('Logout from Delivery Partner App?')) {
    stopLiveGPS();
    localStorage.removeItem('gk_active_rider');
    location.reload();
  }
}

// --- RIDER PIN CHANGE MODAL ---
function openRiderPinModal() {
  if (!activeRider) return;
  const nameEl = document.getElementById('change-pin-rider-name');
  if (nameEl) nameEl.textContent = `${activeRider.name} (${activeRider.vehicle || 'Rider'})`;
  const errEl = document.getElementById('rider-pin-change-error');
  const succEl = document.getElementById('rider-pin-change-success');
  if (errEl) errEl.classList.add('hidden');
  if (succEl) succEl.classList.add('hidden');
  document.getElementById('rider-current-pin').value = '';
  document.getElementById('rider-new-pin').value = '';
  document.getElementById('rider-confirm-pin').value = '';
  const modal = document.getElementById('rider-change-pin-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeRiderPinModal() {
  const modal = document.getElementById('rider-change-pin-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitRiderPinChange(e) {
  e.preventDefault();
  if (!activeRider) return;

  const currentPin = document.getElementById('rider-current-pin').value.trim();
  const newPin = document.getElementById('rider-new-pin').value.trim();
  const confirmPin = document.getElementById('rider-confirm-pin').value.trim();
  const errEl = document.getElementById('rider-pin-change-error');
  const succEl = document.getElementById('rider-pin-change-success');

  errEl.classList.add('hidden');
  succEl.classList.add('hidden');

  if (newPin !== confirmPin) {
    errEl.textContent = 'New PIN and Confirm PIN do not match!';
    errEl.classList.remove('hidden');
    return;
  }

  if (!/^\d{4,6}$/.test(newPin)) {
    errEl.textContent = 'New PIN must be between 4 and 6 numeric digits.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/riders/${activeRider.id}/pin`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Rider-PIN': activeRider.pin || currentPin
      },
      body: JSON.stringify({ currentPin, newPin })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      succEl.textContent = '✓ PIN updated successfully! Next login requires this new PIN.';
      succEl.classList.remove('hidden');
      activeRider.pin = newPin;
      localStorage.setItem('gk_active_rider', JSON.stringify(activeRider));
      setTimeout(() => {
        closeRiderPinModal();
      }, 1600);
    } else {
      errEl.textContent = data.error || 'Failed to update PIN. Please verify your current PIN.';
      errEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = 'Network error while updating PIN.';
    errEl.classList.remove('hidden');
  }
}

let currentDeliveryTab = 'active';

function switchDeliveryTab(tab) {
  currentDeliveryTab = tab;
  const activeBtn = document.getElementById('tab-deliv-active');
  const completedBtn = document.getElementById('tab-deliv-completed');

  if (tab === 'active') {
    if (activeBtn) activeBtn.className = 'py-2.5 rounded-xl bg-amber-500 text-black shadow flex items-center justify-center space-x-1.5 transition';
    if (completedBtn) completedBtn.className = 'py-2.5 rounded-xl text-gray-400 hover:text-white flex items-center justify-center space-x-1.5 transition';
  } else {
    if (activeBtn) activeBtn.className = 'py-2.5 rounded-xl text-gray-400 hover:text-white flex items-center justify-center space-x-1.5 transition';
    if (completedBtn) completedBtn.className = 'py-2.5 rounded-xl bg-emerald-600 text-white shadow flex items-center justify-center space-x-1.5 transition';
  }
  fetchDeliveryOrders();
}

// Fetch Orders available for this Rider
async function fetchDeliveryOrders() {
  if (!activeRider) return;
  try {
    const res = await riderFetch(`/api/delivery/orders?riderId=${activeRider.id}&tab=${currentDeliveryTab}`);
    if (res.status === 401) {
      logoutRider();
      return;
    }
    deliveryOrders = await res.json();

    // Fetch other tab count in parallel for badges
    const otherTab = currentDeliveryTab === 'active' ? 'completed' : 'active';
    const otherRes = await riderFetch(`/api/delivery/orders?riderId=${activeRider.id}&tab=${otherTab}`);
    const otherOrders = await otherRes.json();

    const activeBadge = document.getElementById('delivery-count-badge');
    const completedBadge = document.getElementById('completed-count-badge');

    if (currentDeliveryTab === 'active') {
      if (activeBadge) activeBadge.textContent = deliveryOrders.length;
      if (completedBadge) completedBadge.textContent = otherOrders.length;
    } else {
      if (activeBadge) activeBadge.textContent = otherOrders.length;
      if (completedBadge) completedBadge.textContent = deliveryOrders.length;
    }

    renderDeliveryOrders();
  } catch (e) {
    console.error('Failed to fetch delivery orders:', e);
  }
}

// Render Order Cards
function renderDeliveryOrders() {
  const container = document.getElementById('delivery-orders-list');
  if (!container) return;

  if (deliveryOrders.length === 0) {
    container.innerHTML = `
      <div class="py-16 text-center text-gray-500 bg-zinc-900/60 rounded-3xl border border-zinc-800 p-6 space-y-2">
        <span class="text-4xl block">${currentDeliveryTab === 'active' ? '✨' : '🎉'}</span>
        <p class="font-black text-gray-200 text-base">
          ${currentDeliveryTab === 'active' ? 'No Active Deliveries' : 'No Completed Deliveries Yet'}
        </p>
        <p class="text-xs text-gray-500">
          ${currentDeliveryTab === 'active' ? 'All orders delivered! You have completed all active deliveries.' : 'Orders you mark delivered today will show here.'}
        </p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = deliveryOrders.map(order => {
    const isCompleted = order.status === 'completed';
    const isPickedUp = order.status === 'out_for_delivery';
    const isCOD = order.paymentMethod === 'cod';

    // Format phone for direct action
    const cleanPhone = order.phone.replace(/[^0-9]/g, '');
    const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address + ', Punjab, India')}`;

    return `
      <div class="bg-zinc-900 border ${isCompleted ? 'border-emerald-500/40 opacity-90' : isPickedUp ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-zinc-800'} rounded-3xl p-5 space-y-4 shadow-xl">
        
        <!-- Header & Status -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs font-mono font-black text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/30">${order.id}</span>
            <span class="text-[10px] text-gray-400 ml-1.5">${new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <span class="text-xs font-extrabold px-3 py-1 rounded-full ${isCompleted ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50' : isPickedUp ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50' : 'bg-blue-600/30 text-blue-300 border border-blue-500/50'}">
            ${isCompleted ? '✓ Delivered' : isPickedUp ? '🛵 On The Way' : '🍳 Ready for Pickup'}
          </span>
        </div>

        <!-- Customer Card -->
        <div class="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/80 space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="font-black text-sm text-white flex items-center space-x-1.5">
              <span>👤 ${order.customerName}</span>
            </h4>
            <div class="flex space-x-2">
              <a href="tel:${order.phone}" class="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold">
                <i data-lucide="phone" class="w-4 h-4"></i>
              </a>
              <a href="https://wa.me/${waPhone}?text=Hello%20${encodeURIComponent(order.customerName)}!%20I%20am%20your%20Guru%20Kirpa%20delivery%20partner%20delivering%20order%20${order.id}." target="_blank" class="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                <i data-lucide="message-circle" class="w-4 h-4"></i>
              </a>
            </div>
          </div>

          <!-- Address -->
          <div class="text-xs text-gray-300 pt-1 flex items-start space-x-1.5">
            <i data-lucide="map-pin" class="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5"></i>
            <div>
              <p class="font-bold text-white text-xs">${order.address}</p>
              ${order.notes ? `<p class="text-[11px] text-amber-300 mt-0.5">Note: ${order.notes}</p>` : ''}
            </div>
          </div>

          <!-- Google Maps Navigation Button -->
          <div class="pt-1">
            <a href="${gmapsUrl}" target="_blank" class="w-full py-2.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-emerald-400 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shadow">
              <i data-lucide="navigation" class="w-4 h-4 text-emerald-400"></i>
              <span>Open in Google Maps Navigation</span>
            </a>
          </div>
        </div>

        <!-- Cash Collection Banner -->
        <div class="p-3 rounded-2xl ${isCOD ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300' : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'} flex items-center justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-wider font-extrabold">${isCompleted ? '✓ PAYMENT COMPLETED' : isCOD ? '💵 Collect Cash On Delivery' : '✅ Pre-Paid Online'}</p>
            <p class="text-base font-black ${isCOD ? 'text-amber-400' : 'text-emerald-400'}">${isCompleted ? `PAID: ₹${order.grandTotal}` : isCOD ? `COLLECT: ₹${order.grandTotal}` : 'DO NOT COLLECT CASH'}</p>
          </div>
          <span class="text-xs font-bold bg-black/40 px-2.5 py-1 rounded-lg">${order.paymentMethod.toUpperCase()}</span>
        </div>

        <!-- Order Items Summary -->
        <div class="text-xs space-y-1 text-gray-400">
          <p class="text-[10px] font-bold uppercase text-gray-500">Items inside package:</p>
          ${order.items.map(i => `
            <div class="flex justify-between text-gray-300">
              <span>${i.quantity}x ${i.name}</span>
              <span class="font-mono">₹${i.itemTotal}</span>
            </div>
          `).join('')}
        </div>

        <!-- Action Buttons -->
        <div class="pt-2">
          ${isCompleted ? `
            <div class="w-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-extrabold py-3.5 rounded-2xl text-xs flex items-center justify-center space-x-2 shadow">
              <i data-lucide="check-circle" class="w-4 h-4"></i>
              <span>Order Delivered Successfully ✓</span>
            </div>
          ` : !isPickedUp ? `
            <button onclick="pickupOrder('${order.id}')" class="w-full gold-glow-btn text-black font-extrabold py-3.5 rounded-2xl text-sm flex items-center justify-center space-x-2 shadow-lg">
              <i data-lucide="package-check" class="w-5 h-5"></i>
              <span>Accept & Pick Up Order</span>
            </button>
          ` : `
            <button onclick="completeDelivery('${order.id}', ${order.grandTotal}, ${isCOD})" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3.5 rounded-2xl text-sm flex items-center justify-center space-x-2 shadow-lg shadow-emerald-900/40">
              <i data-lucide="check-circle-2" class="w-5 h-5"></i>
              <span>${isCOD ? `Delivered & Collected ₹${order.grandTotal}` : 'Mark Delivered Successfully'}</span>
            </button>
          `}
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Accept and Pick up Order
async function pickupOrder(orderId) {
  try {
    const res = await riderFetch(`/api/delivery/orders/${orderId}/pickup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId: activeRider.id })
    });

    if (res.ok) {
      alert(`Order #${orderId} Picked up! 🛵 Live GPS location sharing is now active for customer.`);
      fetchDeliveryOrders();
      sendGpsLocation(orderId);
    }
  } catch (err) {
    alert('Failed to pick up order');
  }
}

// Complete Delivery
async function completeDelivery(orderId, amount, isCOD) {
  const confirmMsg = isCOD 
    ? `Confirm delivery for #${orderId}?\nDid you collect ₹${amount} cash from customer?`
    : `Confirm delivery for #${orderId}?`;

  if (confirm(confirmMsg)) {
    try {
      const res = await riderFetch(`/api/delivery/orders/${orderId}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: activeRider.id })
      });

      if (res.ok) {
        alert(`Order #${orderId} marked Delivered successfully! Good job! 🎉`);
        fetchDeliveryOrders();
      }
    } catch (e) {
      alert('Failed to mark delivery');
    }
  }
}

// Live GPS Sharing
function startLiveGPS() {
  if (!navigator.geolocation) {
    console.warn('Geolocation is not supported by browser');
    return;
  }

  // Watch real position
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentCoords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        speed: pos.coords.speed || 0,
        heading: pos.coords.heading || 0
      };

      updateGpsDisplay(currentCoords.lat, currentCoords.lng);
      sendGpsLocation();
    },
    (err) => {
      console.warn('GPS Error/Permission:', err.message);
      document.getElementById('current-latlng-display').textContent = 'GPS: Permission Needed (Click Demo Sim)';
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
  );
}

function stopLiveGPS() {
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  if (simulationInterval) clearInterval(simulationInterval);
}

function updateGpsDisplay(lat, lng) {
  const el = document.getElementById('current-latlng-display');
  if (el) el.textContent = `GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Send GPS coordinates to server
async function sendGpsLocation(specificOrderId = null) {
  const activeOrder = specificOrderId 
    ? deliveryOrders.find(o => o.id === specificOrderId)
    : deliveryOrders.find(o => o.status === 'out_for_delivery');

  try {
    await riderFetch('/api/delivery/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: activeOrder ? activeOrder.id : null,
        riderId: activeRider ? activeRider.id : 'rider-1',
        lat: currentCoords.lat,
        lng: currentCoords.lng,
        speed: currentCoords.speed || 25,
        heading: currentCoords.heading || 0
      })
    });
  } catch (e) {
    // ignore background network glitch
  }
}

// Built-in Demo GPS Simulator
// Moves the scooter along a path so anyone testing on laptop/desktop can see the map marker moving!
function toggleGpsSimulation() {
  const btn = document.getElementById('simulate-gps-btn');
  if (isSimulatingGPS) {
    clearInterval(simulationInterval);
    isSimulatingGPS = false;
    btn.textContent = '🚗 Demo GPS Sim';
    btn.className = 'px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 font-bold border border-amber-500/40 text-[10px]';
    alert('GPS simulation stopped');
    return;
  }

  isSimulatingGPS = true;
  btn.textContent = '🛑 Stop Sim';
  btn.className = 'px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] animate-pulse';

  let step = 0;
  // Starting point (Restaurant) towards customer destination
  let simLat = 30.9010;
  let simLng = 75.8573;

  simulationInterval = setInterval(() => {
    step++;
    // Small realistic scooter movement delta (~20-30 meters per step)
    simLat += 0.0003;
    simLng += 0.0004;

    currentCoords = {
      lat: simLat,
      lng: simLng,
      speed: 30,
      heading: 45
    };

    updateGpsDisplay(simLat, simLng);
    sendGpsLocation();
  }, 2500);

  alert('🚗 GPS Simulation Started! Rider coordinates are now moving live every 2.5 seconds. Check the Customer Order Tracking Map to watch the scooter move!');
}

// SSE listener for new jobs
function initDeliverySSE() {
  try {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_order' || data.type === 'order_status_update') {
          fetchDeliveryOrders();
        }
        if (data.type === 'force_logout') {
          localStorage.removeItem('gk_active_rider');
          alert('Security Notice: Your session has been revoked by Administrator. Please log in with your updated PIN.');
          location.reload();
        }
      } catch (err) {}
    };
  } catch (e) {}
}
