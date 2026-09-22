// Guru Kirpa Fast Food - Customer App Logic
let menu = [];
let settings = {};
let cart = JSON.parse(localStorage.getItem('gk_cart') || '[]');
let activeCategory = 'all';
let searchQuery = '';
let currentOrderType = 'delivery';
let activeOrderId = localStorage.getItem('gk_active_order_id') || null;

// Audio beep for in-app feedback using Web Audio API
function playChime(freq = 600, type = 'sine', duration = 0.15) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // ignore audio block
  }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  fetchSettings();
  fetchMenu();
  loadCustomerReviews();
  updateCartUI();
  setupPaymentListener();
  initSSE();

  // If there is an active tracking order saved in localStorage, show the track order button
  if (activeOrderId) {
    const trackBtn = document.getElementById('track-order-nav-btn');
    if (trackBtn) trackBtn.classList.remove('hidden');
  }
});

// Fetch Settings
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();
    const upiElem = document.getElementById('store-upi-id');
    if (upiElem && settings.upiId) upiElem.textContent = settings.upiId;
    updateCartUI(); // Re-render cart with dynamic delivery fee
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Fetch Menu Items
async function fetchMenu() {
  try {
    const res = await fetch('/api/menu');
    menu = await res.json();
    renderMenu();
  } catch (err) {
    console.error('Failed to load menu:', err);
    document.getElementById('menu-grid').innerHTML = `
      <div class="col-span-full text-center py-12 text-red-400">
        Failed to load menu. Please refresh the page.
      </div>
    `;
  }
}

// State for interactive portion toggling (Half vs Full)
let selectedPortions = {};

function selectDishPortion(dishKey, portion) {
  selectedPortions[dishKey] = portion;
  renderMenu();
}

// Filter Categories
function filterCategory(category) {
  activeCategory = category;
  
  // Update pill styles
  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.classList.remove('bg-amber-500', 'text-black', 'shadow-md');
    btn.classList.add('bg-zinc-900', 'text-gray-300', 'border-zinc-800');
  });

  const activeBtn = event ? event.currentTarget : null;
  if (activeBtn) {
    activeBtn.classList.remove('bg-zinc-900', 'text-gray-300', 'border-zinc-800');
    activeBtn.classList.add('bg-amber-500', 'text-black', 'shadow-md');
  }

  // Update title
  const titleElem = document.getElementById('current-category-title');
  if (titleElem) {
    const categoryNames = {
      'all': 'All Menu Dishes',
      'Chaap': '🍢 Punjabi Chaap & Tikkas',
      'Burger': '🍔 Crispy Burgers',
      'Drink Crush': '🥤 Drink Crush (12 Shakes)',
      'Aloo Tikki': '🥔 Street-Style Aloo Tikki',
      'Fast Food': '🌯 Fast Food & Stuffed Rolls',
      'Momos': '🥟 Fresh Steamed & Fried Momos'
    };
    titleElem.firstElementChild.textContent = categoryNames[category] || category;
  }

  renderMenu();
}

// Search Filter
function handleSearch() {
  searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
  renderMenu();
}

// Render Menu Cards with Interactive Half / Full Portion Toggle
function renderMenu() {
  const container = document.getElementById('menu-grid');
  if (!container) return;

  let filtered = menu;

  if (activeCategory !== 'all') {
    filtered = filtered.filter(item => item.category === activeCategory);
  }

  if (searchQuery) {
    filtered = filtered.filter(item => 
      item.name.toLowerCase().includes(searchQuery) ||
      (item.baseName && item.baseName.toLowerCase().includes(searchQuery)) ||
      (item.description && item.description.toLowerCase().includes(searchQuery)) ||
      item.category.toLowerCase().includes(searchQuery)
    );
  }

  // Group items by dishKey so Half & Full portions share a single elegant card
  const dishGroups = [];
  const dishMap = new Map();

  for (const item of filtered) {
    const key = item.dishKey || item.id;
    if (!dishMap.has(key)) {
      const group = {
        dishKey: key,
        baseName: item.baseName || item.name.replace(/\s*\((Half|Full)\)/i, ''),
        category: item.category,
        description: item.description,
        image: item.image,
        isVeg: item.isVeg !== false,
        hasAddon: !!item.hasAddon,
        variants: []
      };
      dishMap.set(key, group);
      dishGroups.push(group);
    }
    dishMap.get(key).variants.push(item);
  }

  // Update items count badge
  const countBadge = document.getElementById('items-count-badge');
  if (countBadge) countBadge.textContent = `${dishGroups.length} dishes (${filtered.length} options)`;

  if (dishGroups.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-500">
        <span class="text-4xl block mb-2">🍽️</span>
        <p class="font-bold text-gray-300">No items found matching "${searchQuery || activeCategory}"</p>
        <p class="text-xs text-gray-500 mt-1">Try searching for chaap, momos, burger or shake</p>
      </div>
    `;
    return;
  }

  container.innerHTML = dishGroups.map(dish => {
    const hasVariants = dish.variants.length > 1;
    const activePortion = selectedPortions[dish.dishKey] || (dish.variants[0].portion || 'Half');
    const currentItem = dish.variants.find(v => v.portion === activePortion) || dish.variants[0];

    const cartItem = cart.find(c => c.id === currentItem.id && !c.withIceCream);
    const inCartQty = cartItem ? cartItem.quantity : 0;
    const isOutOfStock = currentItem.inStock === false;
    const isBestseller = dish.dishKey === 'ch-1' || dish.dishKey === 'bg-1' || dish.dishKey === 'mo-1' || dish.dishKey === 'dr-1' || dish.dishKey === 'at-1' || dish.dishKey === 'ff-1';

    return `
      <div class="cool-food-card rounded-2xl overflow-hidden flex flex-col group ${isOutOfStock ? 'opacity-60 grayscale-[40%]' : ''} border border-zinc-800/80 hover:border-amber-500/50 transition duration-300 bg-[#121215]">
        
        <!-- Image & Badges -->
        <div class="relative h-48 w-full overflow-hidden bg-zinc-900">
          <img src="${dish.image}" alt="${dish.baseName}" loading="lazy" class="w-full h-full object-cover group-hover:scale-108 transition duration-500">
          <div class="absolute inset-0 bg-gradient-to-t from-black/95 via-black/25 to-transparent"></div>
          
          <!-- Category & Veg Badge -->
          <div class="absolute top-2.5 left-2.5 flex items-center space-x-1.5">
            <span class="veg-icon bg-black/80 backdrop-blur-sm border-emerald-400" title="100% Pure Veg">
              <span class="veg-icon-dot bg-emerald-400"></span>
            </span>
            <span class="bg-black/80 backdrop-blur-sm text-gray-200 text-[10px] font-bold px-2 py-0.5 rounded-md border border-zinc-700">
              ${dish.category}
            </span>
          </div>

          <!-- Top-Right Star Rating -->
          <div class="absolute top-2.5 right-2.5 flex items-center space-x-1">
            <span class="bg-black/80 backdrop-blur-sm text-amber-400 font-black text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 shadow flex items-center space-x-0.5">
              <span>⭐</span>
              <span>4.9</span>
            </span>
          </div>

          <!-- Bottom Badges: Addon & Prep Time & Bestseller -->
          <div class="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between">
            <div class="flex items-center space-x-1">
              ${isBestseller ? `
                <span class="bestseller-badge text-white font-extrabold text-[9px] px-2 py-0.5 rounded shadow tracking-wide">
                  🔥 BESTSELLER
                </span>
              ` : ''}
              ${dish.hasAddon ? `
                <span class="bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow">
                  + Ice Cream Available
                </span>
              ` : ''}
            </div>
            <span class="bg-black/80 backdrop-blur-sm text-gray-300 text-[9px] font-bold px-1.5 py-0.5 rounded border border-zinc-700">
              ⏱️ 12-15m
            </span>
          </div>

          ${isOutOfStock ? `
            <div class="absolute inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center">
              <span class="bg-red-600 text-white font-black text-xs px-3 py-1 rounded-full uppercase tracking-wider shadow-lg">
                Sold Out
              </span>
            </div>
          ` : ''}
        </div>

        <!-- Details -->
        <div class="p-4 flex flex-col flex-grow justify-between space-y-3">
          <div>
            <div class="flex items-start justify-between gap-2">
              <h4 class="font-black text-base text-white group-hover:text-amber-400 transition leading-snug">${dish.baseName}</h4>
              <span class="text-amber-400 font-black text-lg whitespace-nowrap">₹${currentItem.price}</span>
            </div>
            <p class="text-xs text-gray-400 line-clamp-2 mt-1 leading-relaxed">${dish.description || 'Freshly prepared vegetarian fast food.'}</p>
          </div>

          <!-- Portion Selector (Half vs Full) for dishes with multiple sizes -->
          ${hasVariants ? `
            <div class="portion-toggle-container">
              ${dish.variants.map(v => `
                <button type="button" onclick="selectDishPortion('${dish.dishKey}', '${v.portion}')"
                  class="portion-toggle-btn ${v.portion === currentItem.portion ? 'active' : ''}">
                  ${v.portion} • ₹${v.price}
                </button>
              `).join('')}
            </div>
          ` : ''}

          <!-- Add to Cart / Quantity Actions -->
          <div class="pt-1">
            ${isOutOfStock ? `
              <button disabled class="w-full py-2.5 rounded-xl bg-zinc-800 text-gray-500 text-xs font-bold cursor-not-allowed">
                Currently Unavailable
              </button>
            ` : inCartQty > 0 ? `
              <div class="flex items-center justify-between bg-zinc-900 border border-amber-500/60 rounded-xl p-1 shadow-inner">
                <button onclick="decrementCart('${currentItem.id}')" class="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 font-bold flex items-center justify-center transition">
                  -
                </button>
                <span class="font-extrabold text-white text-xs px-2">${inCartQty} ${hasVariants ? `(${currentItem.portion})` : ''} in basket</span>
                <button onclick="incrementCart('${currentItem.id}')" class="w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-extrabold flex items-center justify-center transition">
                  +
                </button>
              </div>
            ` : `
              <button onclick="handleAddToCart('${currentItem.id}')" class="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-amber-500 hover:text-black border border-zinc-700 hover:border-amber-500 text-amber-400 text-xs font-extrabold transition duration-200 flex items-center justify-center space-x-1.5 shadow-sm group-hover:border-amber-500/60">
                <i data-lucide="plus" class="w-4 h-4"></i>
                <span>Add ${hasVariants ? `${currentItem.portion} (₹${currentItem.price})` : 'to Basket'}</span>
              </button>
            `}
          </div>

        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Add to Cart handler
function handleAddToCart(itemId) {
  const item = menu.find(m => m.id === itemId);
  if (!item || !item.inStock) return;

  // If item is a shake and hasAddon, offer rich ice cream addon
  if (item.hasAddon) {
    promptAddon(item);
    return;
  }

  addToCart(item, false);
}

// Addon Prompt for Shakes
function promptAddon(item) {
  const wantIceCream = confirm(`Add a scoop of rich Ice Cream to your ${item.name} for only ₹20 extra? 🍦\n\n• Regular Shake: ₹60 (Click CANCEL)\n• With Ice Cream: ₹80 (Click OK)`);
  addToCart(item, wantIceCream);
}

function addToCart(item, withIceCream = false) {
  playChime(750, 'sine', 0.1);
  const existing = cart.find(c => c.id === item.id && c.withIceCream === withIceCream);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: item.id,
      name: item.name + (withIceCream ? ' (+Ice Cream)' : ''),
      price: item.price,
      withIceCream,
      image: item.image,
      quantity: 1
    });
  }
  saveCart();
  renderMenu();
  updateCartUI();
}

function incrementCart(itemId) {
  const item = cart.find(c => c.id === itemId);
  if (item) {
    item.quantity += 1;
    saveCart();
    renderMenu();
    updateCartUI();
    playChime(800, 'sine', 0.08);
  }
}

function decrementCart(itemId) {
  const itemIndex = cart.findIndex(c => c.id === itemId);
  if (itemIndex > -1) {
    if (cart[itemIndex].quantity > 1) {
      cart[itemIndex].quantity -= 1;
    } else {
      cart.splice(itemIndex, 1);
    }
    saveCart();
    renderMenu();
    updateCartUI();
    playChime(400, 'sine', 0.08);
  }
}

function incrementCartIndex(idx) {
  if (cart[idx]) {
    cart[idx].quantity += 1;
    saveCart();
    renderMenu();
    updateCartUI();
    playChime(800, 'sine', 0.08);
  }
}

function decrementCartIndex(idx) {
  if (cart[idx]) {
    if (cart[idx].quantity > 1) {
      cart[idx].quantity -= 1;
    } else {
      cart.splice(idx, 1);
    }
    saveCart();
    renderMenu();
    updateCartUI();
    playChime(400, 'sine', 0.08);
  }
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  renderMenu();
  updateCartUI();
}

function saveCart() {
  localStorage.setItem('gk_cart', JSON.stringify(cart));
}

// Update Cart Drawer & Badges
function updateCartUI() {
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => {
    const itemPrice = item.price + (item.withIceCream ? 20 : 0);
    return sum + (itemPrice * item.quantity);
  }, 0);

  const deliveryThreshold = settings.freeDeliveryAbove || 299;
  const standardDelivery = settings.deliveryFee || 30;
  const deliveryFee = (subtotal === 0 || subtotal >= deliveryThreshold) ? 0 : standardDelivery;
  const grandTotal = subtotal + (currentOrderType === 'delivery' ? deliveryFee : 0);

  // Update Nav Badge & Total
  const countBadge = document.getElementById('cart-count-badge');
  const navTotal = document.getElementById('cart-total-nav');
  if (countBadge) countBadge.textContent = totalCount;
  if (navTotal) navTotal.textContent = `₹${grandTotal}`;

  // Update Mobile Floating Cart
  const mobileCart = document.getElementById('mobile-floating-cart');
  const mobileBadge = document.getElementById('mobile-cart-badge');
  const mobileTotal = document.getElementById('mobile-cart-total');
  if (mobileCart && mobileBadge && mobileTotal) {
    if (totalCount > 0) {
      mobileCart.classList.remove('translate-y-28');
      mobileBadge.textContent = `${totalCount} Items`;
      mobileTotal.textContent = `₹${grandTotal}`;
    } else {
      mobileCart.classList.add('translate-y-28');
    }
  }

  // Update Delivery Progress in Drawer
  const progressText = document.getElementById('delivery-progress-text');
  const progressBar = document.getElementById('delivery-progress-bar');
  if (progressText && progressBar) {
    if (subtotal >= deliveryThreshold) {
      progressText.textContent = `🎉 You unlocked FREE Delivery!`;
      progressBar.style.width = '100%';
    } else {
      const remaining = deliveryThreshold - subtotal;
      progressText.textContent = `Add ₹${remaining} more for FREE Delivery!`;
      const pct = Math.min(100, Math.round((subtotal / deliveryThreshold) * 100));
      progressBar.style.width = `${pct}%`;
    }
  }

  // Update Bill Breakdown in Drawer
  const subtotalElem = document.getElementById('cart-subtotal');
  const deliveryElem = document.getElementById('cart-delivery-fee');
  const grandTotalElem = document.getElementById('cart-grand-total');
  const checkoutBtn = document.getElementById('checkout-btn');

  if (subtotalElem) subtotalElem.textContent = `₹${subtotal}`;
  if (deliveryElem) {
    deliveryElem.textContent = (currentOrderType !== 'delivery' || deliveryFee === 0) ? 'FREE' : `₹${deliveryFee}`;
  }
  if (grandTotalElem) grandTotalElem.textContent = `₹${grandTotal}`;
  if (checkoutBtn) checkoutBtn.disabled = totalCount === 0;

  // Render items inside drawer
  const container = document.getElementById('cart-items-container');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="py-16 text-center text-gray-500">
        <i data-lucide="shopping-cart" class="w-12 h-12 mx-auto text-zinc-700 mb-2"></i>
        <p class="font-semibold text-gray-400">Your food basket is empty</p>
        <p class="text-xs text-gray-600 mt-1">Select your favorite Punjabi Chaap, Burgers or Shakes!</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = cart.map((item, idx) => {
    const itemUnitPrice = item.price + (item.withIceCream ? 20 : 0);
    const itemTotal = itemUnitPrice * item.quantity;
    return `
      <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
        <img src="${item.image}" alt="${item.name}" class="w-12 h-12 rounded-lg object-cover bg-zinc-800 flex-shrink-0">
        
        <div class="flex-grow min-w-0">
          <h5 class="text-xs font-bold text-white truncate">${item.name}</h5>
          <p class="text-[11px] text-amber-400 font-semibold">₹${itemUnitPrice} × ${item.quantity} = ₹${itemTotal}</p>
        </div>

        <div class="flex items-center space-x-1.5 flex-shrink-0">
          <button onclick="decrementCartIndex(${idx})" class="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 font-bold text-xs flex items-center justify-center">
            -
          </button>
          <span class="text-xs font-bold text-white px-1">${item.quantity}</span>
          <button onclick="incrementCartIndex(${idx})" class="w-7 h-7 rounded bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs flex items-center justify-center">
            +
          </button>
          <button onclick="removeFromCart(${idx})" class="w-7 h-7 rounded text-gray-500 hover:text-red-400 flex items-center justify-center ml-1">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// Toggle Cart Drawer
function toggleCartDrawer() {
  const overlay = document.getElementById('cart-drawer-overlay');
  const drawer = document.getElementById('cart-drawer');
  if (!drawer || !overlay) return;

  const isOpen = !drawer.classList.contains('translate-x-full');
  if (isOpen) {
    drawer.classList.add('translate-x-full');
    overlay.classList.add('opacity-0', 'pointer-events-none');
    overlay.classList.remove('opacity-100', 'pointer-events-auto');
  } else {
    drawer.classList.remove('translate-x-full');
    overlay.classList.remove('opacity-0', 'pointer-events-none');
    overlay.classList.add('opacity-100', 'pointer-events-auto');
  }
}

// Order Type Selection (delivery / takeaway / dinein)
function setOrderType(type) {
  currentOrderType = type;
  
  ['delivery', 'takeaway', 'dinein'].forEach(t => {
    const btn = document.getElementById(`type-btn-${t}`);
    if (btn) {
      if (t === type) {
        btn.classList.add('bg-amber-500/20', 'border-amber-500', 'text-amber-300');
        btn.classList.remove('bg-zinc-900', 'border-zinc-700', 'text-gray-300');
      } else {
        btn.classList.remove('bg-amber-500/20', 'border-amber-500', 'text-amber-300');
        btn.classList.add('bg-zinc-900', 'border-zinc-700', 'text-gray-300');
      }
    }
  });

  const addressField = document.getElementById('address-field-container');
  const tableField = document.getElementById('table-field-container');

  if (type === 'dinein') {
    if (addressField) addressField.classList.add('hidden');
    if (tableField) tableField.classList.remove('hidden');
  } else if (type === 'takeaway') {
    if (addressField) addressField.classList.add('hidden');
    if (tableField) tableField.classList.add('hidden');
  } else {
    if (addressField) addressField.classList.remove('hidden');
    if (tableField) tableField.classList.add('hidden');
  }

  updateCartUI();
  updateCheckoutQRCode();
}

// Open Checkout Modal
function openCheckoutModal() {
  if (cart.length === 0) return;
  toggleCartDrawer(); // close drawer

  const modal = document.getElementById('checkout-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
  modal.firstElementChild.classList.remove('scale-95');

  // Pre-fill previous name/phone/address if stored
  const savedName = localStorage.getItem('gk_cust_name');
  const savedPhone = localStorage.getItem('gk_cust_phone');
  const savedAddress = localStorage.getItem('gk_cust_address');
  if (savedName && document.getElementById('cust-name')) document.getElementById('cust-name').value = savedName;
  if (savedPhone && document.getElementById('cust-phone')) document.getElementById('cust-phone').value = savedPhone;
  if (savedAddress && document.getElementById('cust-address')) document.getElementById('cust-address').value = savedAddress;

  updateCheckoutQRCode();
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkout-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
  modal.firstElementChild.classList.add('scale-95');
}

// Payment Radio selection listener
function setupPaymentListener() {
  document.querySelectorAll('input[name="payment-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const upiBox = document.getElementById('upi-qr-box');
      if (e.target.value === 'upi') {
        if (upiBox) upiBox.classList.remove('hidden');
        updateCheckoutQRCode();
      } else {
        if (upiBox) upiBox.classList.add('hidden');
      }
    });
  });
}

// Dynamic UPI QR code generation (100% Local Pure JS Generator + Fallback)
let qrCodeInstance = null;

function updateCheckoutQRCode() {
  const subtotal = cart.reduce((sum, item) => sum + ((item.price + (item.withIceCream ? 20 : 0)) * item.quantity), 0);
  const deliveryThreshold = settings.freeDeliveryAbove || 299;
  const deliveryFee = (subtotal === 0 || subtotal >= deliveryThreshold || currentOrderType !== 'delivery') ? 0 : (settings.deliveryFee || 30);
  const grandTotal = subtotal + deliveryFee;

  const totalElem = document.getElementById('checkout-modal-total');
  const qrAmtElem = document.getElementById('checkout-qr-amount');
  const storeUpiElem = document.getElementById('store-upi-id');
  if (totalElem) totalElem.textContent = `₹${grandTotal}`;
  if (qrAmtElem) qrAmtElem.textContent = `₹${grandTotal}`;
  if (storeUpiElem && settings.upiId) storeUpiElem.textContent = settings.upiId;

  // Generate UPI URI
  const upiId = settings.upiId || '6239591644@okbizaxis';
  const upiName = encodeURIComponent(settings.upiName || 'Guru Kirpa Fast Food');
  const upiURI = `upi://pay?pa=${upiId}&pn=${upiName}&am=${grandTotal}&cu=INR&tn=GuruKirpaOrder`;

  // Set direct UPI mobile launch button
  const directBtn = document.getElementById('pay-upi-direct-btn');
  if (directBtn) {
    directBtn.href = upiURI;
  }

  // Render QR Code locally inside canvas container
  const qrContainer = document.getElementById('upi-qr-canvas-container');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    try {
      if (typeof QRCode !== 'undefined') {
        qrCodeInstance = new QRCode(qrContainer, {
          text: upiURI,
          width: 170,
          height: 170,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } else {
        const img = document.createElement('img');
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiURI)}`;
        img.className = 'w-40 h-40';
        qrContainer.appendChild(img);
      }
    } catch (e) {
      console.warn('QRCode generation fallback:', e);
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiURI)}`;
      img.className = 'w-40 h-40';
      qrContainer.appendChild(img);
    }
  }
}

function copyUPIId() {
  const upiId = settings.upiId || '6239591644@okbizaxis';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(upiId).then(() => {
      alert(`UPI ID "${upiId}" copied to clipboard! Paste in GPay, PhonePe or Paytm to pay.`);
    }).catch(() => {
      prompt('Copy UPI ID:', upiId);
    });
  } else {
    prompt('Copy UPI ID:', upiId);
  }
}

// Submit Order
async function submitOrder() {
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const address = document.getElementById('cust-address').value.trim();
  const table = document.getElementById('cust-table').value.trim();
  const notes = document.getElementById('cust-notes').value.trim();
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;

  if (!name) {
    alert('Please enter your full name');
    document.getElementById('cust-name').focus();
    return;
  }
  if (!phone || phone.length < 10) {
    alert('Please enter a valid 10-digit WhatsApp phone number');
    document.getElementById('cust-phone').focus();
    return;
  }
  if (currentOrderType === 'delivery' && !address) {
    alert('Please enter your complete delivery address');
    document.getElementById('cust-address').focus();
    return;
  }

  // Save details to localStorage for quick ordering next time
  localStorage.setItem('gk_cust_name', name);
  localStorage.setItem('gk_cust_phone', phone);
  if (address) localStorage.setItem('gk_cust_address', address);

  const btn = document.getElementById('place-order-btn');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Placing Order...</span>`;
  if (window.lucide) lucide.createIcons();

  const upiRef = document.getElementById('cust-upi-ref') ? document.getElementById('cust-upi-ref').value.trim() : '';

  const payload = {
    customerName: name,
    phone,
    orderType: currentOrderType,
    address: currentOrderType === 'delivery' ? address : (currentOrderType === 'dinein' ? `Table ${table || 'N/A'}` : 'Takeaway Counter'),
    tableNumber: table,
    notes,
    items: cart,
    paymentMethod,
    upiRef: paymentMethod === 'upi' ? upiRef : ''
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to place order');
    }

    // Confetti celebration blast!
    if (window.confetti) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

    // Save active order ID for live tracking
    activeOrderId = data.order.id;
    localStorage.setItem('gk_active_order_id', activeOrderId);

    // Build WhatsApp message
    const waUrl = buildWhatsAppOrderURL(data.order);

    // Clear cart
    cart = [];
    saveCart();
    renderMenu();
    updateCartUI();

    closeCheckoutModal();
    openTrackModal(data.order, waUrl);

    // Enable track nav button
    const trackBtn = document.getElementById('track-order-nav-btn');
    if (trackBtn) trackBtn.classList.remove('hidden');

  } catch (err) {
    alert(err.message || 'Error creating order. Please try again or call 6239591644.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Confirm & Place Order</span><i data-lucide="check-circle-2" class="w-4 h-4"></i>`;
    if (window.lucide) lucide.createIcons();
  }
}

// Build 1-Click WhatsApp URL formatted text
function buildWhatsAppOrderURL(order) {
  const phone = settings.whatsappPhone || '916239591644';
  
  let itemLines = order.items.map(i => `• ${i.quantity}x ${i.name} (₹${i.itemTotal})`).join('\n');
  
  const text = 
`*🍔 GURU KIRPA FAST FOOD - NEW ORDER 🍔*
*Order ID:* ${order.id}
*Customer:* ${order.customerName}
*Phone:* ${order.phone}
*Order Type:* ${order.orderType.toUpperCase()}
*Address / Details:* ${order.address}
${order.notes ? `*Cooking Notes:* ${order.notes}\n` : ''}
*--- ORDER ITEMS ---*
${itemLines}

*Subtotal:* ₹${order.subtotal}
*Delivery Fee:* ${order.deliveryFee === 0 ? 'FREE' : '₹' + order.deliveryFee}
*GRAND TOTAL: ₹${order.grandTotal}*
*Payment Method:* ${order.paymentMethod === 'upi' ? 'UPI QR Scanned' : 'Cash on Delivery (COD)'}

_Har Bite Me Hai Kirpa ❤️_`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// Leaflet Map instance variables for live tracking
let customerMap = null;
let riderMarker = null;
let restaurantMarker = null;
let customerMarker = null;
let routeLine = null;

// Open Track Order Modal
async function openTrackModal(orderObj = null, waUrl = null) {
  const modal = document.getElementById('tracking-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
  modal.firstElementChild.classList.remove('scale-95');

  if (!orderObj && activeOrderId) {
    try {
      const res = await fetch(`/api/orders/${activeOrderId}`);
      if (res.ok) {
        orderObj = await res.json();
        waUrl = buildWhatsAppOrderURL(orderObj);
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (orderObj) {
    document.getElementById('track-order-id').textContent = `Order #${orderObj.id} • Total: ₹${orderObj.grandTotal}`;
    updateTrackingSteps(orderObj.status, orderObj);
    if (waUrl) {
      const waBtn = document.getElementById('whatsapp-order-link');
      if (waBtn) waBtn.href = waUrl;
    }

    // Setup Live GPS Map
    setupCustomerLiveMap(orderObj);
  }
}

function closeTrackModal() {
  const modal = document.getElementById('tracking-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
  modal.firstElementChild.classList.add('scale-95');
}

// Initialize or update Customer Leaflet Map
function setupCustomerLiveMap(order) {
  const mapWrapper = document.getElementById('live-map-wrapper');
  if (!mapWrapper) return;

  if (order.orderType !== 'delivery') {
    mapWrapper.classList.add('hidden');
    return;
  }
  mapWrapper.classList.remove('hidden');

  // Update rider info card if assigned
  const riderNameEl = document.getElementById('track-rider-name');
  const riderVehicleEl = document.getElementById('track-rider-vehicle');
  const riderCallEl = document.getElementById('track-rider-call');
  const riderTagEl = document.getElementById('rider-status-tag');

  if (order.rider) {
    if (riderNameEl) riderNameEl.textContent = order.rider.name;
    if (riderVehicleEl) riderVehicleEl.textContent = order.rider.vehicle || 'Delivery Partner';
    if (riderCallEl) riderCallEl.href = `tel:${order.rider.phone || '6239591644'}`;
    if (riderTagEl) riderTagEl.textContent = '🛵 Rider On The Way';
  } else {
    if (riderNameEl) riderNameEl.textContent = 'Assigning Nearest Rider...';
    if (riderVehicleEl) riderVehicleEl.textContent = 'Preparing in Kitchen';
    if (riderTagEl) riderTagEl.textContent = 'Kitchen Preparing';
  }

  // Delay map render slightly to allow modal CSS transition
  setTimeout(() => {
    initLeafletMap(order);
  }, 250);
}

function initLeafletMap(order) {
  if (typeof L === 'undefined') return;

  const restLat = 30.9010;
  const restLng = 75.8573;
  // Estimated customer coords (offset slightly for demonstration route)
  const custLat = 30.9055;
  const custLng = 75.8640;

  // Rider coordinates
  const riderCoords = order.currentLocation 
    ? [order.currentLocation.lat, order.currentLocation.lng]
    : [restLat + 0.002, restLng + 0.003];

  if (!customerMap) {
    const mapContainer = document.getElementById('customer-live-map');
    if (!mapContainer) return;

    customerMap = L.map('customer-live-map').setView(riderCoords, 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(customerMap);

    // Restaurant Marker
    const restIcon = L.divIcon({
      className: 'rest-icon',
      html: '<div style="background:#F59E0B; color:#000; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-size:18px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.4);">🍔</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    restaurantMarker = L.marker([restLat, restLng], { icon: restIcon })
      .addTo(customerMap)
      .bindPopup('<b>Guru Kirpa Fast Food</b><br>Kitchen Location');

    // Customer Marker
    const custIcon = L.divIcon({
      className: 'cust-icon',
      html: '<div style="background:#10B981; color:#fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:16px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.4);">🏠</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    customerMarker = L.marker([custLat, custLng], { icon: custIcon })
      .addTo(customerMap)
      .bindPopup(`<b>Delivery Destination</b><br>${order.address || 'Customer'}`);

    // Moving Scooter Rider Marker
    const scooterIcon = L.divIcon({
      className: 'scooter-icon',
      html: '<div style="font-size:28px; filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6)); animation: softPulse 1.5s infinite;">🛵</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    riderMarker = L.marker(riderCoords, { icon: scooterIcon })
      .addTo(customerMap)
      .bindPopup('<b>Guru Kirpa Rider</b><br>On the way with hot food!');

    // Route Polyline
    routeLine = L.polyline([[restLat, restLng], riderCoords, [custLat, custLng]], {
      color: '#F59E0B',
      weight: 4,
      opacity: 0.8,
      dashArray: '8, 8'
    }).addTo(customerMap);

  } else {
    customerMap.invalidateSize();
    if (riderMarker) riderMarker.setLatLng(riderCoords);
    if (routeLine) routeLine.setLatLngs([[restLat, restLng], riderCoords, [custLat, custLng]]);
  }
}

// Smoothly update moving scooter position
function updateRiderGpsPosition(lat, lng) {
  if (riderMarker && customerMap) {
    const newLatLng = new L.LatLng(lat, lng);
    riderMarker.setLatLng(newLatLng);
    if (routeLine) {
      const restLat = 30.9010;
      const restLng = 75.8573;
      const custLat = 30.9055;
      const custLng = 75.8640;
      routeLine.setLatLngs([[restLat, restLng], [lat, lng], [custLat, custLng]]);
    }
  }
}

// Update 4-step Tracker UI based on status & payment
function updateTrackingSteps(status, order = null) {
  const steps = ['received', 'preparing', 'out_for_delivery', 'completed'];
  const currentIndex = steps.indexOf(status);

  steps.forEach((step, idx) => {
    const el = document.getElementById(`step-${step}`);
    if (!el) return;

    const icon = el.firstElementChild;
    const title = el.children[1].children[0];

    if (idx <= currentIndex) {
      icon.className = 'w-8 h-8 rounded-full bg-emerald-500 text-black font-bold flex items-center justify-center text-xs shadow-md shadow-emerald-500/20';
      icon.textContent = '✓';
      title.className = 'text-xs font-bold text-white';
    } else {
      icon.className = 'w-8 h-8 rounded-full bg-zinc-800 text-gray-500 font-bold flex items-center justify-center text-xs';
      icon.textContent = idx + 1;
      title.className = 'text-xs font-bold text-gray-400';
    }
  });

  // Update payment status badge
  const payStatusEl = document.getElementById('track-payment-status');
  if (payStatusEl && order) {
    if (order.paymentStatus === 'paid') {
      payStatusEl.className = 'inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm';
      payStatusEl.innerHTML = '<span>✅ Payment Verified & Received (PAID)</span>';
    } else if (order.paymentMethod === 'cod') {
      payStatusEl.className = 'inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-zinc-800 text-yellow-400 border border-zinc-700';
      payStatusEl.innerHTML = `<span>💵 Cash on Delivery: ₹${order.grandTotal}</span>`;
    } else {
      payStatusEl.className = 'inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30';
      payStatusEl.innerHTML = '<span>⏳ UPI Payment Awaiting Verification</span>';
    }
  }

  // Auto-show review prompt when order is completed
  const reviewPrompt = document.getElementById('post-delivery-review-prompt');
  if (reviewPrompt) {
    if (status === 'completed') {
      reviewPrompt.classList.remove('hidden');
      if (typeof confetti === 'function') {
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
      }
    } else {
      reviewPrompt.classList.add('hidden');
    }
  }
}

function openReviewModalFromOrder() {
  const savedName = localStorage.getItem('gk_cust_name');
  if (savedName && document.getElementById('rev-name')) {
    document.getElementById('rev-name').value = savedName;
  }
  openReviewModal();
}

// Flyer Modal Toggle
function openFlyerModal() {
  const modal = document.getElementById('flyer-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
}

function closeFlyerModal() {
  const modal = document.getElementById('flyer-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
}

// Server-Sent Events (SSE) for Real-Time Status Updates
function initSSE() {
  try {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        
        // If my active order's status updated
        if (data.type === 'order_status_update' && data.payload.orderId === activeOrderId) {
          playChime(900, 'triangle', 0.2);
          updateTrackingSteps(data.payload.status, data.payload.order);
          if (data.payload.order) {
            setupCustomerLiveMap(data.payload.order);
          }
        }

        // Real-time GPS movement from Rider's phone!
        if (data.type === 'rider_location_update') {
          if (!data.payload.orderId || data.payload.orderId === activeOrderId) {
            updateRiderGpsPosition(data.payload.location.lat, data.payload.location.lng);
          }
        }

        // If menu updated in dashboard, refresh local menu
        if (data.type === 'menu_updated') {
          fetchMenu();
        }

        // If settings updated
        if (data.type === 'settings_updated') {
          fetchSettings();
        }

        // If a new review was added
        if (data.type === 'review_added') {
          loadCustomerReviews();
        }
      } catch (err) {
        // ignore parse
      }
    };
  } catch (err) {
    console.warn('SSE not supported or connection failed:', err);
  }
}

// --- CUSTOMER REVIEWS LOGIC ---
let customerReviews = [];

async function loadCustomerReviews() {
  try {
    const res = await fetch('/api/reviews');
    customerReviews = await res.json();
    renderCustomerReviews();
  } catch (e) {
    console.error('Failed to load reviews:', e);
  }
}

function renderCustomerReviews() {
  const container = document.getElementById('customer-reviews-grid');
  if (!container) return;

  if (customerReviews.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-gray-500">
        <p>Be the first to leave a review for Guru Kirpa Fast Food!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = customerReviews.map(r => `
    <div class="cool-food-card rounded-2xl p-4 flex flex-col justify-between space-y-3 relative group">
      <div>
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <div class="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 font-black flex items-center justify-center text-xs">
              ${(r.name || 'G').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h5 class="text-xs font-bold text-white">${r.name}</h5>
              <span class="text-[10px] text-gray-500">${r.date || 'Recent Foodie'}</span>
            </div>
          </div>
          <span class="text-amber-400 text-xs">${'★'.repeat(r.rating || 5)}</span>
        </div>

        <p class="text-xs text-gray-300 italic mt-2.5 line-clamp-3 leading-relaxed">
          "${r.comment}"
        </p>
      </div>

      <div class="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
        <span class="text-amber-400 font-semibold truncate max-w-[120px]">❤️ ${r.itemLiked || 'Pure Veg'}</span>
        <span class="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">✓ Verified</span>
      </div>
    </div>
  `).join('');
}

function openReviewModal() {
  const modal = document.getElementById('review-modal');
  modal.classList.remove('opacity-0', 'pointer-events-none');
  setRating(5);
}

function closeReviewModal() {
  const modal = document.getElementById('review-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
}

let selectedRating = 5;
function setRating(val) {
  selectedRating = val;
  const input = document.getElementById('review-rating-val');
  if (input) input.value = val;

  const buttons = document.querySelectorAll('#star-picker .star-btn');
  buttons.forEach((btn, idx) => {
    if (idx < val) {
      btn.classList.add('text-amber-400');
      btn.classList.remove('text-zinc-600');
    } else {
      btn.classList.remove('text-amber-400');
      btn.classList.add('text-zinc-600');
    }
  });
}

async function submitCustomerReview(e) {
  e.preventDefault();
  const name = document.getElementById('review-name').value.trim();
  const itemLiked = document.getElementById('review-item').value.trim();
  const comment = document.getElementById('review-comment').value.trim();
  const rating = selectedRating || 5;

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rating, comment, itemLiked })
    });

    if (res.ok) {
      if (window.confetti) {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 } });
      }
      playChime(850, 'sine', 0.2);
      closeReviewModal();
      document.getElementById('review-form').reset();
      loadCustomerReviews();
      alert('Thank you for your valuable feedback! Your review is now live ❤️');
    } else {
      alert('Failed to submit review');
    }
  } catch (err) {
    alert(err.message);
  }
}
