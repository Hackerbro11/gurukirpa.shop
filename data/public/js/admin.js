// Guru Kirpa Fast Food - Kitchen Admin Dashboard Logic
let orders = [];
let menu = [];
let settings = {};
let adminRiders = [];
let activeStatusFilter = 'active';
let currentTab = 'orders';
let soundAlertsEnabled = localStorage.getItem('gk_admin_sound') !== 'false';
let adminUnlocked = sessionStorage.getItem('gk_admin_unlocked') === 'true';

// 2-tone Kitchen Bell chime using Web Audio API
function playKitchenBell() {
  if (!soundAlertsEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Tone 1
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, audioCtx.currentTime);
    gain1.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.4);

    // Tone 2 (Higher Ding)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.35, audioCtx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(audioCtx.currentTime + 0.15);
    osc2.stop(audioCtx.currentTime + 0.8);

    // Tone 3 (Final Chime)
    const osc3 = audioCtx.createOscillator();
    const gain3 = audioCtx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1600, audioCtx.currentTime + 0.3);
    gain3.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.3);
    gain3.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
    osc3.connect(gain3);
    gain3.connect(audioCtx.destination);
    osc3.start(audioCtx.currentTime + 0.3);
    osc3.stop(audioCtx.currentTime + 1.2);
  } catch (e) {
    console.warn('Audio play restricted by browser:', e);
  }
}

function playTestChime() {
  playKitchenBell();
  alert('🔔 Kitchen bell chime tested successfully! Your sound alerts are active.');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  
  if (adminUnlocked) {
    unlockDashboardUI();
  } else {
    document.getElementById('pin-lock-modal').classList.remove('hidden');
    document.getElementById('admin-pin-input').focus();
  }

  updateAudioButtonUI();
});

function getAdminPIN() {
  return sessionStorage.getItem('gk_admin_pin') || '';
}

async function adminFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  headers['X-Admin-PIN'] = getAdminPIN();
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    console.warn('Admin session expired or invalid PIN');
    sessionStorage.removeItem('gk_admin_unlocked');
    sessionStorage.removeItem('gk_admin_pin');
    const modal = document.getElementById('pin-lock-modal');
    if (modal) modal.classList.remove('hidden');
  }
  return res;
}

// Verify PIN
async function verifyAdminPIN() {
  const pinInput = document.getElementById('admin-pin-input');
  const errorText = document.getElementById('pin-error-text');
  const pin = pinInput.value.trim();

  try {
    const res = await fetch('/api/settings/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });

    if (res.ok) {
      sessionStorage.setItem('gk_admin_unlocked', 'true');
      sessionStorage.setItem('gk_admin_pin', pin);
      adminUnlocked = true;
      unlockDashboardUI();
    } else {
      errorText.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
    }
  } catch (err) {
    errorText.textContent = 'Server connection error. Please try again.';
    errorText.classList.remove('hidden');
  }
}

function unlockDashboardUI() {
  const modal = document.getElementById('pin-lock-modal');
  if (modal) modal.classList.add('hidden');
  
  loadSettings();
  loadOrders();
  loadMenu();
  loadStats();
  loadAdminRiders();
  initAdminSSE();
}

async function loadAdminRiders() {
  try {
    const res = await fetch('/api/riders');
    adminRiders = await res.json();
  } catch (e) {
    console.error('Failed to load riders:', e);
  }
}

function lockDashboard() {
  sessionStorage.removeItem('gk_admin_unlocked');
  sessionStorage.removeItem('gk_admin_pin');
  location.reload();
}

// Toggle Audio Alerts
function toggleAudioAlerts() {
  soundAlertsEnabled = !soundAlertsEnabled;
  localStorage.setItem('gk_admin_sound', soundAlertsEnabled);
  updateAudioButtonUI();
}

function updateAudioButtonUI() {
  const label = document.getElementById('audio-status-label');
  const btn = document.getElementById('audio-alert-btn');
  if (label && btn) {
    if (soundAlertsEnabled) {
      label.textContent = 'Sound: ON';
      btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition';
    } else {
      label.textContent = 'Sound: MUTED';
      btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-semibold text-gray-500 hover:bg-zinc-800 transition';
    }
  }
}

// Tab Switching
function switchTab(tab) {
  currentTab = tab;
  
  ['orders', 'menu', 'analytics', 'reviews', 'settings'].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-content-${t}`);
    if (btn && content) {
      if (t === tab) {
        btn.classList.add('active', 'text-amber-400', 'border-b-2', 'border-amber-500');
        btn.classList.remove('text-gray-400');
        content.classList.remove('hidden');
      } else {
        btn.classList.remove('active', 'text-amber-400', 'border-b-2', 'border-amber-500');
        btn.classList.add('text-gray-400');
        content.classList.add('hidden');
      }
    }
  });

  if (tab === 'menu') renderAdminMenu();
  if (tab === 'analytics') loadStats();
  if (tab === 'reviews') loadReviews();
  if (tab === 'settings') {
    loadSettings();
    loadAdminRidersList();
  }
}

// Filter Status inside Orders tab
function filterOrderStatus(status) {
  activeStatusFilter = status;
  
  document.querySelectorAll('.status-filter-btn').forEach(btn => {
    btn.classList.remove('bg-amber-500', 'text-black', 'shadow-md', 'font-black');
    btn.classList.add('bg-zinc-800', 'text-gray-300');
  });

  const activeBtn = document.getElementById(`filter-btn-${status}`) || (window.event ? window.event.currentTarget : null);
  if (activeBtn) {
    activeBtn.classList.remove('bg-zinc-800', 'text-gray-300');
    activeBtn.classList.add('bg-amber-500', 'text-black', 'shadow-md', 'font-black');
  }

  renderOrders();
}

// Load Orders from Server
async function loadOrders() {
  try {
    const res = await adminFetch('/api/orders');
    orders = await res.json();
    renderOrders();
    updatePendingBadge();
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

// Update pending orders pill & filter button badges
function updatePendingBadge() {
  const activeKitchenCount = orders.filter(o => ['received', 'preparing', 'out_for_delivery'].includes(o.status)).length;
  const pendingCount = orders.filter(o => o.status === 'received').length;
  const completedCount = orders.filter(o => o.status === 'completed').length;

  const pill = document.getElementById('pending-count-pill');
  if (pill) {
    pill.textContent = pendingCount;
    if (pendingCount > 0) {
      pill.classList.remove('hidden');
      pill.classList.add('animate-pulse');
    } else {
      pill.classList.remove('animate-pulse');
    }
  }

  const activeBadge = document.getElementById('badge-active-count');
  if (activeBadge) activeBadge.textContent = activeKitchenCount;

  const completedBadge = document.getElementById('badge-completed-count');
  if (completedBadge) completedBadge.textContent = completedCount;
}

// Render Orders Grid
function renderOrders() {
  const container = document.getElementById('admin-orders-container');
  if (!container) return;

  let filtered = orders;
  if (activeStatusFilter === 'active') {
    // Strictly ONLY active kitchen orders: received, preparing, out_for_delivery
    filtered = orders.filter(o => ['received', 'preparing', 'out_for_delivery'].includes(o.status));
  } else if (activeStatusFilter !== 'all') {
    filtered = orders.filter(o => o.status === activeStatusFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-500 bg-zinc-950 border border-zinc-800 rounded-3xl p-6 space-y-2">
        <i data-lucide="${activeStatusFilter === 'active' ? 'check-circle-2' : 'inbox'}" class="w-12 h-12 mx-auto ${activeStatusFilter === 'active' ? 'text-emerald-500' : 'text-zinc-700'} mb-2"></i>
        <p class="font-black text-gray-200 text-base">
          ${activeStatusFilter === 'active' ? 'Kitchen Queue is Clear! 🎉' : `No ${activeStatusFilter} orders`}
        </p>
        <p class="text-xs text-gray-500 max-w-sm mx-auto">
          ${activeStatusFilter === 'active' ? 'Completed orders are automatically removed and saved in "Completed History". New incoming orders will ring here in real-time!' : 'No orders in this status category.'}
        </p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(order => {
    const isNew = order.status === 'received';
    const isPreparing = order.status === 'preparing';
    const isOut = order.status === 'out_for_delivery';
    const isCompleted = order.status === 'completed';
    const isCancelled = order.status === 'cancelled';

    const statusBadgeClasses = {
      'received': 'bg-amber-500/20 text-amber-400 border-amber-500/50 animate-pulse',
      'preparing': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
      'out_for_delivery': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
      'completed': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
      'cancelled': 'bg-red-500/20 text-red-400 border-red-500/50'
    }[order.status] || 'bg-zinc-800 text-gray-300';

    const statusLabels = {
      'received': '🔥 New Order Received',
      'preparing': '🍳 Cooking in Kitchen',
      'out_for_delivery': '🛵 Out for Delivery',
      'completed': '✓ Completed',
      'cancelled': '✕ Cancelled'
    };

    const formattedTime = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="bg-zinc-950 border ${isNew ? 'border-amber-500 shadow-xl shadow-amber-500/10 ring-1 ring-amber-500' : 'border-zinc-800'} rounded-2xl p-4 flex flex-col justify-between space-y-3 transition duration-200">
        
        <!-- Header -->
        <div>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center space-x-2">
              <span class="font-mono font-black text-sm text-white">${order.id}</span>
              <span class="text-[10px] text-gray-400">(${formattedTime})</span>
            </div>
            <span class="border px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadgeClasses}">
              ${statusLabels[order.status] || order.status}
            </span>
          </div>

          <!-- Customer Info -->
          <div class="mt-2.5 p-2.5 bg-zinc-900/80 rounded-xl border border-zinc-800/80 text-xs space-y-1">
            <div class="flex justify-between items-center font-bold text-white">
              <span>👤 ${order.customerName}</span>
              <a href="tel:${order.phone}" class="text-amber-400 underline font-mono">${order.phone}</a>
            </div>
            <div class="text-gray-300 flex items-start space-x-1">
              <span class="text-gray-500 font-medium">📍</span>
              <span class="line-clamp-2">${order.address}</span>
            </div>
            ${order.notes ? `
              <div class="text-amber-300 bg-amber-500/10 p-1.5 rounded text-[11px] font-medium border border-amber-500/20">
                💬 Note: ${order.notes}
              </div>
            ` : ''}
          </div>

          <!-- Items Ordered List -->
          <div class="mt-3 space-y-1.5 text-xs">
            <div class="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Ordered Items (${order.items.length})</div>
            ${order.items.map(item => `
              <div class="flex justify-between items-center py-1 border-b border-zinc-900 text-gray-200">
                <span class="font-semibold text-white">
                  <span class="text-amber-400 font-bold">${item.quantity}×</span> ${item.name}
                </span>
                <span class="font-mono text-gray-400">₹${item.itemTotal}</span>
              </div>
            `).join('')}
          </div>

          <!-- Total & Payment Verification Status -->
          <div class="mt-3 pt-2.5 border-t border-zinc-800 space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-[10px] uppercase font-bold text-gray-400">Payment: </span>
                <span class="font-bold ${order.paymentMethod === 'upi' ? 'text-emerald-400' : 'text-amber-400'} uppercase">
                  ${order.paymentMethod === 'upi' ? 'UPI QR' : 'Cash on Delivery'}
                </span>
              </div>
              <div class="text-right">
                <span class="text-base font-black text-amber-400 font-mono">₹${order.grandTotal}</span>
              </div>
            </div>

            ${order.paymentMethod === 'upi' ? `
              ${order.paymentStatus === 'paid' ? `
                <div class="flex items-center justify-between bg-emerald-500/15 border border-emerald-500/40 p-2 rounded-xl text-emerald-300 text-[11px] font-bold">
                  <span class="flex items-center space-x-1">
                    <span>✅ Payment Verified & Received</span>
                  </span>
                  <span class="font-mono text-[10px] text-emerald-400">PAID</span>
                </div>
              ` : `
                <div class="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl space-y-1.5 text-xs">
                  <div class="flex justify-between items-center text-[11px]">
                    <span class="text-amber-400 font-bold flex items-center space-x-1">
                      <span>⏳ Awaiting Soundbox / Bank Alert</span>
                    </span>
                    ${order.upiRef ? `<span class="text-[10px] font-mono text-gray-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-700">Ref: ${order.upiRef}</span>` : ''}
                  </div>
                  <button onclick="confirmOrderPayment('${order.id}', ${order.grandTotal})" class="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center justify-center space-x-1.5 shadow-md shadow-emerald-900/40 transition">
                    <span>✅ Confirm Payment Received (₹${order.grandTotal})</span>
                  </button>
                </div>
              `}
            ` : `
              <div class="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-2 rounded-xl text-gray-300 text-[11px]">
                <span>💵 Collect Cash on Delivery:</span>
                <span class="font-bold text-amber-400 font-mono">₹${order.grandTotal}</span>
              </div>
            `}
          </div>

          <!-- Rider Assignment for Delivery Orders -->
          ${order.orderType === 'delivery' ? `
            <div class="mt-2.5 p-2 bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-between text-xs">
              <div class="flex items-center space-x-1.5">
                <span class="text-sm">🛵</span>
                <span class="text-[11px] text-gray-300 font-semibold truncate max-w-[120px]">
                  ${order.rider ? order.rider.name : 'No Rider Assigned'}
                </span>
              </div>
              <select onchange="assignRiderToOrder('${order.id}', this.value)" class="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-amber-400 font-bold focus:outline-none cursor-pointer">
                <option value="">${order.rider ? 'Change Rider' : 'Assign Rider...'}</option>
                ${adminRiders.map(r => `
                  <option value="${r.id}" ${order.rider && order.rider.id === r.id ? 'selected' : ''}>${r.name}</option>
                `).join('')}
              </select>
            </div>
          ` : ''}
        </div>

        <!-- Kitchen Status Controls & Quick Actions -->
        <div class="pt-2 border-t border-zinc-800 space-y-2">
          
          <!-- Status Transition Buttons -->
          <div class="grid grid-cols-2 gap-2">
            ${isNew ? `
              <button onclick="updateOrderStatus('${order.id}', 'preparing')" class="col-span-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs flex items-center justify-center space-x-1 shadow-md">
                <i data-lucide="flame" class="w-4 h-4"></i>
                <span>Accept & Start Cooking</span>
              </button>
            ` : isPreparing ? `
              <button onclick="updateOrderStatus('${order.id}', 'out_for_delivery')" class="col-span-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center space-x-1 shadow-md">
                <i data-lucide="bike" class="w-4 h-4"></i>
                <span>Mark Out for Delivery</span>
              </button>
            ` : isOut ? `
              <button onclick="updateOrderStatus('${order.id}', 'completed')" class="col-span-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center space-x-1 shadow-md">
                <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                <span>Mark Delivered & Paid</span>
              </button>
            ` : isCompleted ? `
              <div class="col-span-2 text-center text-xs text-emerald-400 font-bold py-1">
                ✓ Order Completed
              </div>
            ` : `
              <div class="col-span-2 text-center text-xs text-red-400 font-bold py-1">
                ✕ Order Cancelled
              </div>
            `}
          </div>

          <!-- Utility Print & WhatsApp Buttons -->
          <div class="grid grid-cols-3 gap-1.5 pt-1">
            
            <!-- Print KOT -->
            <button onclick="printKOT('${order.id}')" title="Print Kitchen Order Ticket" class="py-1.5 px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] font-semibold text-gray-200 flex items-center justify-center space-x-1">
              <i data-lucide="printer" class="w-3.5 h-3.5 text-amber-400"></i>
              <span>KOT</span>
            </button>

            <!-- Print Bill Receipt -->
            <button onclick="printCustomerBill('${order.id}')" title="Print Customer Bill Invoice" class="py-1.5 px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] font-semibold text-gray-200 flex items-center justify-center space-x-1">
              <i data-lucide="file-text" class="w-3.5 h-3.5 text-blue-400"></i>
              <span>Bill</span>
            </button>

            <!-- WhatsApp Customer Update -->
            <button onclick="notifyCustomerWhatsApp('${order.id}')" title="Notify customer on WhatsApp" class="py-1.5 px-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/60 text-[11px] font-semibold text-emerald-300 flex items-center justify-center space-x-1">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              <span>WA</span>
            </button>

          </div>

          ${(!isCompleted && !isCancelled) ? `
            <div class="text-right">
              <button onclick="cancelOrder('${order.id}')" class="text-[10px] text-gray-500 hover:text-red-400 font-semibold underline">
                Cancel Order
              </button>
            </div>
          ` : ''}

        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Update Order Status
async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await adminFetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (res.ok) {
      const updatedOrder = await res.json();
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx > -1) {
        orders[idx] = updatedOrder;
      }
      renderOrders();
      loadStats();
      updatePendingBadge();
    }
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
}

async function assignRiderToOrder(orderId, riderId) {
  if (!riderId) return;
  try {
    const res = await adminFetch(`/api/delivery/orders/${orderId}/pickup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId })
    });

    if (res.ok) {
      const data = await res.json();
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx > -1) {
        orders[idx] = data.order;
      }
      renderOrders();
      alert(`Rider ${data.order.rider.name} assigned to #${orderId}! Status updated to Out for Delivery.`);
    }
  } catch (e) {
    alert('Failed to assign rider');
  }
}

// 1-Click UPI Payment Confirmation
async function confirmOrderPayment(orderId, amount) {
  if (confirm(`Confirm that payment of ₹${amount} was received for Order #${orderId}?`)) {
    try {
      const res = await adminFetch(`/api/orders/${orderId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'paid' })
      });

      if (res.ok) {
        const idx = orders.findIndex(o => o.id === orderId);
        if (idx > -1) {
          orders[idx].paymentStatus = 'paid';
        }
        renderOrders();
        loadStats();
        playKitchenBell();
        alert(`Payment of ₹${amount} for Order #${orderId} verified & marked PAID! ✓`);
      }
    } catch (e) {
      alert('Failed to confirm payment: ' + e.message);
    }
  }
}

function cancelOrder(orderId) {
  if (confirm(`Are you sure you want to CANCEL order #${orderId}?`)) {
    updateOrderStatus(orderId, 'cancelled');
  }
}

// Print Kitchen Order Ticket (KOT) for thermal printer (80mm)
function printKOT(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const kotBox = document.getElementById('printable-kot');
  kotBox.innerHTML = `
    <div style="font-family: monospace; font-size: 13px; line-height: 1.4; color: #000; width: 80mm; padding: 5px;">
      <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 5px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: bold;">GURU KIRPA FAST FOOD</h2>
        <p style="margin: 2px 0 0 0; font-size: 14px; font-weight: bold;">** KITCHEN ORDER TICKET (KOT) **</p>
      </div>

      <div style="margin: 8px 0; font-size: 12px; border-bottom: 1px dashed #000; padding-bottom: 5px;">
        <div><b>Order No:</b> ${order.id}</div>
        <div><b>Type:</b> ${order.orderType.toUpperCase()}</div>
        <div><b>Time:</b> ${new Date(order.createdAt).toLocaleTimeString()}</div>
        <div><b>Customer:</b> ${order.customerName} (${order.phone})</div>
        <div><b>Table / Loc:</b> ${order.address}</div>
        ${order.notes ? `<div style="margin-top: 4px; background: #eee; padding: 2px;"><b>NOTE:</b> ${order.notes}</div>` : ''}
      </div>

      <table style="width: 100%; font-size: 13px; margin: 8px 0; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #000; text-align: left;">
            <th style="width: 25px;">[ ]</th>
            <th style="width: 35px;">QTY</th>
            <th>ITEM NAME</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(item => `
            <tr style="border-bottom: 1px dotted #ccc;">
              <td style="padding: 4px 0;">[ ]</td>
              <td style="padding: 4px 0; font-weight: bold; font-size: 15px;">${item.quantity}x</td>
              <td style="padding: 4px 0; font-weight: bold;">${item.name}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="border-top: 2px dashed #000; padding-top: 5px; text-align: center; font-size: 11px;">
        100% PURE VEG • COOK FRESH & HOT
      </div>
    </div>
  `;

  window.print();
}

// Print Customer Bill / Tax Invoice
function printCustomerBill(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const kotBox = document.getElementById('printable-kot');
  kotBox.innerHTML = `
    <div style="font-family: monospace; font-size: 13px; line-height: 1.4; color: #000; width: 80mm; padding: 5px;">
      <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 5px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: bold;">GURU KIRPA FAST FOOD</h2>
        <p style="margin: 2px 0 0 0; font-size: 11px;">Har Bite Me Hai Kirpa ❤️</p>
        <p style="margin: 2px 0 0 0; font-size: 11px;">Phone: 6239591644 • 100% PURE VEG</p>
      </div>

      <div style="margin: 8px 0; font-size: 12px; border-bottom: 1px dashed #000; padding-bottom: 5px;">
        <div><b>Invoice:</b> ${order.id}</div>
        <div><b>Date:</b> ${new Date(order.createdAt).toLocaleString()}</div>
        <div><b>Customer:</b> ${order.customerName} (${order.phone})</div>
        <div><b>Address:</b> ${order.address}</div>
        <div><b>Payment:</b> ${order.paymentMethod.toUpperCase()} (${order.paymentStatus})</div>
      </div>

      <table style="width: 100%; font-size: 12px; margin: 8px 0; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #000; text-align: left;">
            <th>Item</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Price</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(item => `
            <tr>
              <td style="padding: 3px 0;">${item.name}</td>
              <td style="text-align: center;">${item.quantity}</td>
              <td style="text-align: right;">₹${item.price + (item.addonPrice || 0)}</td>
              <td style="text-align: right; font-weight: bold;">₹${item.itemTotal}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="border-top: 1px dashed #000; padding-top: 5px; font-size: 12px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Subtotal:</span>
          <span>₹${order.subtotal}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Delivery Charge:</span>
          <span>₹${order.deliveryFee}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">
          <span>GRAND TOTAL:</span>
          <span>₹${order.grandTotal}</span>
        </div>
      </div>

      <div style="border-top: 2px dashed #000; margin-top: 8px; padding-top: 5px; text-align: center; font-size: 11px;">
        Thank You! Visit Again ❤️<br/>
        For Next Orders Call: 6239591644
      </div>
    </div>
  `;

  window.print();
}

// Notify customer with direct WhatsApp message link
function notifyCustomerWhatsApp(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const cleanPhone = order.phone.replace(/[^0-9]/g, '');
  const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  let msg = `Hello ${order.customerName}! 👋\n`;
  if (order.status === 'preparing') {
    msg += `Your delicious order *#${order.id}* is currently being prepared hot & fresh in our kitchen! 🍳🔥`;
  } else if (order.status === 'out_for_delivery') {
    msg += `Great news! Your order *#${order.id}* is OUT FOR DELIVERY and heading to you! 🛵💨`;
  } else if (order.status === 'completed') {
    msg += `Your order *#${order.id}* has been delivered! Enjoy your meal! Thank you for ordering with Guru Kirpa Fast Food ❤️`;
  } else {
    msg += `Thank you for your order *#${order.id}* at Guru Kirpa Fast Food! Total: ₹${order.grandTotal}.`;
  }

  msg += `\n\n_Guru Kirpa Fast Food • Har Bite Me Hai Kirpa_`;

  window.open(`https://wa.me/${targetPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Menu Management
async function loadMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderAdminMenu();
  } catch (err) {
    console.error('Failed to load menu:', err);
  }
}

function renderAdminMenu() {
  const tbody = document.getElementById('admin-menu-table-body');
  if (!tbody) return;

  tbody.innerHTML = menu.map(item => `
    <tr class="hover:bg-zinc-900/50 transition">
      <td class="p-3.5 flex items-center space-x-3">
        <img src="${item.image}" alt="${item.name}" class="w-10 h-10 rounded-lg object-cover bg-zinc-800">
        <div>
          <p class="font-bold text-white text-xs">${item.name}</p>
          <p class="text-[10px] text-gray-500 line-clamp-1">${item.description}</p>
        </div>
      </td>
      <td class="p-3.5">
        <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800 text-gray-300">${item.category}</span>
      </td>
      <td class="p-3.5 font-bold text-amber-400 font-mono text-xs">
        ₹${item.price}
      </td>
      <td class="p-3.5">
        <button onclick="toggleItemStock('${item.id}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold transition ${item.inStock !== false ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-red-500/20 text-red-400 border border-red-500/40'}">
          ${item.inStock !== false ? '● In Stock' : '✕ Out of Stock'}
        </button>
      </td>
      <td class="p-3.5 text-right space-x-2">
        <button onclick="openEditItemModal('${item.id}')" class="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-bold text-xs border border-amber-500/40">✏️ Edit Dish</button>
        <button onclick="deleteMenuItem('${item.id}')" class="text-gray-500 hover:text-red-400 text-xs ml-1">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function toggleItemStock(itemId) {
  try {
    const res = await adminFetch(`/api/menu/${itemId}/toggle`, { method: 'PATCH' });
    if (res.ok) {
      const updated = await res.json();
      const idx = menu.findIndex(m => m.id === itemId);
      if (idx > -1) menu[idx] = updated;
      renderAdminMenu();
    }
  } catch (e) {
    alert('Failed to toggle stock');
  }
}

async function editItemPrice(itemId, oldPrice) {
  const newPrice = prompt(`Enter new price in ₹ for this item:`, oldPrice);
  if (newPrice && !isNaN(newPrice) && Number(newPrice) > 0) {
    try {
      const res = await adminFetch(`/api/menu/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: Number(newPrice) })
      });
      if (res.ok) {
        const updated = await res.json();
        const idx = menu.findIndex(m => m.id === itemId);
        if (idx > -1) menu[idx] = updated;
        renderAdminMenu();
      }
    } catch (e) {
      alert('Failed to update price');
    }
  }
}

async function deleteMenuItem(itemId) {
  if (confirm('Are you sure you want to delete this menu item?')) {
    try {
      const res = await adminFetch(`/api/menu/${itemId}`, { method: 'DELETE' });
      if (res.ok) {
        menu = menu.filter(m => m.id !== itemId);
        renderAdminMenu();
      }
    } catch (e) {
      alert('Failed to delete item');
    }
  }
}

// Add Item Modal
function openAddItemModal() {
  const modal = document.getElementById('add-item-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
}

function closeAddItemModal() {
  const modal = document.getElementById('add-item-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
  document.getElementById('add-item-form').reset();
}

async function submitNewMenuItem(e) {
  e.preventDefault();
  const name = document.getElementById('new-item-name').value.trim();
  const category = document.getElementById('new-item-category').value;
  const price = document.getElementById('new-item-price').value;
  const description = document.getElementById('new-item-desc').value.trim();
  const image = document.getElementById('new-item-img').value.trim();

  try {
    const res = await adminFetch('/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category,
        price,
        description,
        image: image || undefined,
        isVeg: true
      })
    });

    if (res.ok) {
      const newItem = await res.json();
      menu.push(newItem);
      renderAdminMenu();
      closeAddItemModal();
      alert('New item added successfully!');
    }
  } catch (err) {
    alert('Failed to create item');
  }
}

// Analytics & Stats
async function loadStats() {
  try {
    const res = await adminFetch('/api/stats');
    const stats = await res.json();

    const salesEl = document.getElementById('stat-sales');
    const ordersEl = document.getElementById('stat-orders');
    const activeEl = document.getElementById('stat-active');
    const completedEl = document.getElementById('stat-completed');

    if (salesEl) salesEl.textContent = `₹${stats.todaySales}`;
    if (ordersEl) ordersEl.textContent = stats.totalTodayOrders;
    if (activeEl) activeEl.textContent = stats.activeOrders;
    if (completedEl) completedEl.textContent = stats.completedOrders;

    // Render top items list
    const topList = document.getElementById('top-items-list');
    if (topList) {
      if (stats.topItems && stats.topItems.length > 0) {
        topList.innerHTML = stats.topItems.map((item, idx) => `
          <div class="flex items-center justify-between p-2.5 bg-zinc-900 rounded-xl text-xs">
            <div class="flex items-center space-x-2">
              <span class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[10px]">${idx + 1}</span>
              <span class="font-semibold text-white">${item.name}</span>
            </div>
            <span class="font-bold text-amber-400">${item.qty} ordered</span>
          </div>
        `).join('');
      } else {
        topList.innerHTML = `<p class="text-xs text-gray-500 py-4 text-center">No orders recorded yet today.</p>`;
      }
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Settings Load & Save
async function loadSettings() {
  try {
    const res = await adminFetch('/api/settings');
    settings = await res.json();

    const phoneInput = document.getElementById('setting-phone');
    const upiInput = document.getElementById('setting-upi');
    const feeInput = document.getElementById('setting-delivery-fee');
    const freeInput = document.getElementById('setting-free-delivery');

    if (phoneInput && settings.phone) phoneInput.value = settings.phone;
    if (upiInput && settings.upiId) upiInput.value = settings.upiId;
    if (feeInput && settings.deliveryFee) feeInput.value = settings.deliveryFee;
    if (freeInput && settings.freeDeliveryAbove) freeInput.value = settings.freeDeliveryAbove;
  } catch (e) {
    console.error(e);
  }
}

async function saveStoreSettings(e) {
  e.preventDefault();
  const phone = document.getElementById('setting-phone').value.trim();
  const upiId = document.getElementById('setting-upi').value.trim();
  const deliveryFee = Number(document.getElementById('setting-delivery-fee').value);
  const freeDeliveryAbove = Number(document.getElementById('setting-free-delivery').value);
  const adminPin = document.getElementById('setting-admin-pin').value.trim();

  const currentPin = sessionStorage.getItem('gk_admin_pin') || '';
  const payload = {
    pin: currentPin,
    phone,
    whatsappPhone: '91' + phone.replace(/[^0-9]/g, '').slice(-10),
    upiId,
    deliveryFee,
    freeDeliveryAbove
  };

  if (adminPin) {
    payload.adminPin = adminPin;
  }

  try {
    const res = await adminFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      if (adminPin) sessionStorage.setItem('gk_admin_pin', adminPin);
      alert('Settings saved successfully!');
    } else {
      alert('Failed to save settings');
    }
  } catch (err) {
    alert(err.message);
  }
}

// --- ADMIN RIDER PIN MANAGEMENT ---
async function loadAdminRidersList() {
  const container = document.getElementById('admin-riders-pin-list');
  if (!container) return;

  try {
    const res = await adminFetch('/api/admin/riders');
    if (!res.ok) throw new Error('Failed to load riders');
    const ridersData = await res.json();
    adminRiders = ridersData;

    container.innerHTML = ridersData.map(r => `
      <div class="p-3.5 bg-zinc-900/90 rounded-xl border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center font-bold text-sm text-amber-400">
            🛵
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <h5 class="text-sm font-bold text-white">${r.name}</h5>
              <span class="text-[10px] font-bold px-1.5 py-0.2 rounded ${r.status === 'available' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">${r.status || 'Active'}</span>
            </div>
            <p class="text-[11px] text-gray-400 font-mono mt-0.5">${r.vehicle || 'Vehicle'} • Phone: ${r.phone || 'N/A'}</p>
          </div>
        </div>

        <div class="flex items-center space-x-2 self-end sm:self-center">
          <div class="flex items-center space-x-1.5 bg-zinc-950 px-2.5 py-1.5 rounded-xl border border-zinc-700">
            <span class="text-[11px] text-gray-400 font-semibold">PIN:</span>
            <input type="text" id="rider-pin-val-${r.id}" value="${r.pin || '1111'}" maxlength="6" class="w-16 bg-transparent text-center font-mono font-bold text-amber-400 text-sm focus:outline-none">
          </div>
          <button type="button" onclick="updateRiderPinFromAdmin('${r.id}')" class="gold-glow-btn text-black font-extrabold px-3 py-1.5 rounded-xl text-xs flex items-center space-x-1 shadow transition">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>Save PIN</span>
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-red-400 text-center py-3">Could not load rider credentials.</p>`;
  }
}

async function updateRiderPinFromAdmin(riderId) {
  const input = document.getElementById(`rider-pin-val-${riderId}`);
  if (!input) return;
  const newPin = input.value.trim();

  if (!/^\d{4,6}$/.test(newPin)) {
    alert('PIN must be 4 to 6 numeric digits (e.g. 1111, 1234)!');
    return;
  }

  try {
    const res = await adminFetch(`/api/riders/${riderId}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✓ ${data.message}! Login PIN is now: ${newPin}`);
      loadAdminRidersList();
    } else {
      alert(data.error || 'Failed to update rider PIN');
    }
  } catch (err) {
    alert('Error updating PIN: ' + err.message);
  }
}

// Emergency Session Revocation
async function revokeAllSessions() {
  if (!confirm('Are you sure you want to revoke ALL active rider and kitchen sessions? Everyone will be logged out immediately.')) {
    return;
  }
  try {
    const res = await adminFetch('/api/security/revoke-all-sessions', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('✓ ' + data.message);
      sessionStorage.removeItem('gk_admin_unlocked');
      sessionStorage.removeItem('gk_admin_pin');
      location.reload();
    } else {
      alert(data.error || 'Failed to revoke sessions');
    }
  } catch (e) {
    alert('Network error: ' + e.message);
  }
}

// --- FULL EDIT DISH MODAL LOGIC ---
const PRESET_IMAGES = {
  chaap: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=500&q=80',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=500&q=80',
  shake: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=500&q=80',
  roll: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=500&q=80',
  panipuri: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=500&q=80'
};

function setPresetImage(type) {
  const url = PRESET_IMAGES[type];
  if (url) {
    document.getElementById('edit-item-img').value = url;
    updateImagePreview(url);
  }
}

function updateImagePreview(url) {
  const preview = document.getElementById('edit-item-img-preview');
  if (preview) {
    preview.src = url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80';
  }
}

function openEditItemModal(itemId) {
  const item = menu.find(m => m.id === itemId);
  if (!item) return;

  document.getElementById('edit-item-id').value = item.id;
  document.getElementById('edit-item-name').value = item.name;
  document.getElementById('edit-item-category').value = item.category;
  document.getElementById('edit-item-price').value = item.price;
  document.getElementById('edit-item-desc').value = item.description || '';
  document.getElementById('edit-item-img').value = item.image || '';
  document.getElementById('edit-item-stock').checked = item.inStock !== false;
  document.getElementById('edit-item-addon').checked = !!item.hasAddon;

  updateImagePreview(item.image);

  const modal = document.getElementById('edit-item-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
}

function closeEditItemModal() {
  const modal = document.getElementById('edit-item-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
}

async function saveEditedMenuItem(e) {
  e.preventDefault();
  const id = document.getElementById('edit-item-id').value;
  const name = document.getElementById('edit-item-name').value.trim();
  const category = document.getElementById('edit-item-category').value;
  const price = Number(document.getElementById('edit-item-price').value);
  const description = document.getElementById('edit-item-desc').value.trim();
  const image = document.getElementById('edit-item-img').value.trim();
  const inStock = document.getElementById('edit-item-stock').checked;
  const hasAddon = document.getElementById('edit-item-addon').checked;

  try {
    const res = await adminFetch(`/api/menu/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category,
        price,
        description,
        image: image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
        inStock,
        hasAddon
      })
    });

    if (res.ok) {
      const updated = await res.json();
      const idx = menu.findIndex(m => m.id === id);
      if (idx > -1) menu[idx] = updated;
      renderAdminMenu();
      closeEditItemModal();
      alert(`Dish "${name}" updated successfully! Changes are live on customer app.`);
    } else {
      alert('Failed to update dish');
    }
  } catch (err) {
    alert(err.message);
  }
}

// --- CUSTOMER REVIEWS IN ADMIN ---
let adminReviews = [];

async function loadReviews() {
  try {
    const res = await fetch('/api/reviews');
    adminReviews = await res.json();
    renderReviews();
  } catch (e) {
    console.error('Failed to load reviews:', e);
  }
}

function renderReviews() {
  const container = document.getElementById('admin-reviews-container');
  if (!container) return;

  if (adminReviews.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-500 bg-zinc-950 border border-zinc-800 rounded-2xl p-6">
        <p class="font-bold text-gray-300">No customer reviews yet</p>
        <p class="text-xs text-gray-500 mt-1">Reviews submitted by customers will show here!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = adminReviews.map(r => `
    <div class="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-2.5 shadow-lg">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <div class="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-xs">
            ${r.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h5 class="font-bold text-white text-xs">${r.name}</h5>
            <span class="text-[10px] text-gray-500">${r.date || 'Recent'}</span>
          </div>
        </div>
        <div class="flex text-amber-400 text-xs">
          ${'⭐'.repeat(r.rating || 5)}
        </div>
      </div>

      <p class="text-xs text-gray-300 leading-relaxed italic">"${r.comment}"</p>

      ${r.itemLiked ? `
        <div class="pt-1 flex items-center justify-between text-[11px] text-gray-400 border-t border-zinc-900">
          <span>Favorite: <b class="text-amber-400">${r.itemLiked}</b></span>
          <span class="text-emerald-400 font-bold">✓ Verified Order</span>
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Real-Time Server-Sent Events (SSE) for Admin
function initAdminSSE() {
  try {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        
        // When a new order arrives
        if (data.type === 'new_order') {
          playKitchenBell();
          orders.unshift(data.payload);
          renderOrders();
          loadStats();
          updatePendingBadge();
        }

        // When order status is updated
        if (data.type === 'order_status_update') {
          const idx = orders.findIndex(o => o.id === data.payload.orderId);
          if (idx > -1) {
            orders[idx].status = data.payload.status;
            renderOrders();
            loadStats();
            updatePendingBadge();
          }
        }

        // When a review is added
        if (data.type === 'review_added') {
          adminReviews.unshift(data.payload);
          renderReviews();
        }

        // When sessions are revoked by admin
        if (data.type === 'force_logout') {
          sessionStorage.removeItem('gk_admin_unlocked');
          sessionStorage.removeItem('gk_admin_pin');
          alert('Security Alert: Active session revoked by administrator. Please log in again.');
          location.reload();
        }
      } catch (err) {
        // ignore parse
      }
    };
  } catch (e) {
    console.warn('Admin SSE connection error:', e);
  }
}
