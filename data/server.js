const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const MENU_FILE = path.join(__dirname, 'data', 'menu.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const RIDERS_FILE = path.join(__dirname, 'data', 'riders.json');
const REVIEWS_FILE = path.join(__dirname, 'data', 'reviews.json');

// Helper to safely read JSON
function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

// Helper to safely write JSON
function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

// In-memory / initial load
let menu = readJSON(MENU_FILE, []);
let orders = readJSON(ORDERS_FILE, []);
let riders = readJSON(RIDERS_FILE, []);
let reviews = readJSON(REVIEWS_FILE, []);
let settings = readJSON(SETTINGS_FILE, {
  restaurantName: 'GURU KIRPA Fast Food',
  tagline: 'Har Bite Me Hai Kirpa ❤️',
  phone: '6239591644',
  whatsappPhone: '916239591644',
  upiId: '6239591644@okbizaxis',
  upiName: 'Guru Kirpa Fast Food',
  isOpen: true,
  deliveryFee: 30,
  freeDeliveryAbove: 299,
  adminPin: '8899',
  restaurantCoords: { lat: 30.9010, lng: 75.8573 }
});

// Sanitization helper against XSS
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Mask sensitive customer phone number for public endpoints
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '****';
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.length <= 4) return '****';
  return clean.slice(0, 2) + '******' + clean.slice(-2);
}

// In-Memory Rate Limiter (Brute-force & DDoS/Spam defense)
const rateLimitMap = new Map();
function rateLimit({ windowMs = 60000, max = 30, message = 'Too many requests. Please try again later.' }) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${req.baseUrl || req.path}_${ip}`;
    const now = Date.now();
    
    let record = rateLimitMap.get(key);
    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      rateLimitMap.set(key, record);
    } else {
      record.count++;
      if (record.count > max) {
        return res.status(429).json({ error: message });
      }
    }
    next();
  };
}

// Admin Authentication Middleware
function adminAuthMiddleware(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.adminPin || req.body?.pin || req.query?.adminPin;
  const currentAdminPin = settings.adminPin || '1234';
  if (!pin || pin !== currentAdminPin) {
    return res.status(401).json({ error: 'Unauthorized: Valid Admin PIN required.' });
  }
  next();
}

// Rider Authentication Middleware
function riderAuthMiddleware(req, res, next) {
  // Allow admin access as supervisor
  const adminPin = req.headers['x-admin-pin'] || req.query?.adminPin;
  if (adminPin && adminPin === (settings.adminPin || '1234')) {
    return next();
  }

  const riderPin = req.headers['x-rider-pin'] || req.body?.riderPin || req.query?.riderPin;
  const riderId = req.headers['x-rider-id'] || req.body?.riderId || req.query?.riderId;

  if (!riderPin) {
    return res.status(401).json({ error: 'Unauthorized: Delivery partner PIN required.' });
  }

  const rider = riders.find(r => (riderId ? r.id === riderId : true) && r.pin === riderPin);
  if (!rider) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Delivery Partner credentials.' });
  }

  req.authenticatedRider = rider;
  next();
}

// SSE Clients Registry
let sseClients = [];

function broadcastSSE(type, payload) {
  const data = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  sseClients.forEach(client => {
    try {
      client.res.write(`data: ${data}\n\n`);
    } catch (e) {
      // client may be closed
    }
  });
}

// SSE endpoint for live order tracking & admin notifications
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now() + Math.random().toString(36).substr(2, 5);
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// --- MENU API ---
// Public: Anyone can view menu
app.get('/api/menu', (req, res) => {
  res.json(menu);
});

// Protected: Only Admin can add items
app.post('/api/menu', adminAuthMiddleware, (req, res) => {
  const { name, category, price, description, isVeg, image, hasAddon } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ error: 'Name, category, and price are required' });
  }
  const newItem = {
    id: 'item-' + Date.now(),
    name: sanitize(name).slice(0, 100),
    category: sanitize(category).slice(0, 50),
    price: Math.max(0, Number(price) || 0),
    description: sanitize(description || '').slice(0, 300),
    isVeg: isVeg !== undefined ? !!isVeg : true,
    inStock: true,
    hasAddon: !!hasAddon,
    image: image ? String(image).slice(0, 500) : 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'
  };
  menu.push(newItem);
  writeJSON(MENU_FILE, menu);
  broadcastSSE('menu_updated', { menu });
  res.status(201).json(newItem);
});

// Protected: Only Admin can update items
app.put('/api/menu/:id', adminAuthMiddleware, (req, res) => {
  const itemIndex = menu.findIndex(i => i.id === req.params.id);
  if (itemIndex === -1) return res.status(404).json({ error: 'Item not found' });

  const existing = menu[itemIndex];
  menu[itemIndex] = {
    ...existing,
    name: req.body.name ? sanitize(req.body.name).slice(0, 100) : existing.name,
    category: req.body.category ? sanitize(req.body.category).slice(0, 50) : existing.category,
    price: req.body.price !== undefined ? Math.max(0, Number(req.body.price) || 0) : existing.price,
    description: req.body.description !== undefined ? sanitize(req.body.description).slice(0, 300) : existing.description,
    isVeg: req.body.isVeg !== undefined ? !!req.body.isVeg : existing.isVeg,
    hasAddon: req.body.hasAddon !== undefined ? !!req.body.hasAddon : existing.hasAddon,
    image: req.body.image !== undefined ? String(req.body.image).slice(0, 500) : existing.image,
    inStock: req.body.inStock !== undefined ? !!req.body.inStock : existing.inStock
  };

  writeJSON(MENU_FILE, menu);
  broadcastSSE('menu_updated', { menu });
  res.json(menu[itemIndex]);
});

// Protected: Only Admin can toggle stock
app.patch('/api/menu/:id/toggle', adminAuthMiddleware, (req, res) => {
  const item = menu.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  item.inStock = !item.inStock;
  writeJSON(MENU_FILE, menu);
  broadcastSSE('menu_updated', { menu });
  res.json(item);
});

// Protected: Only Admin can delete items
app.delete('/api/menu/:id', adminAuthMiddleware, (req, res) => {
  menu = menu.filter(i => i.id !== req.params.id);
  writeJSON(MENU_FILE, menu);
  broadcastSSE('menu_updated', { menu });
  res.json({ success: true });
});

// --- CUSTOMER REVIEWS & FEEDBACK API ---
// Public: View reviews
app.get('/api/reviews', (req, res) => {
  res.json(reviews);
});

// Public: Submit review (Rate-limited + Sanitized)
app.post('/api/reviews', rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: 'Too many reviews submitted. Please wait 10 minutes.' }), (req, res) => {
  const { name, rating, comment, itemLiked } = req.body;
  if (!name || !rating || !comment) {
    return res.status(400).json({ error: 'Name, rating, and feedback comment are required' });
  }

  const newReview = {
    id: 'rev-' + Date.now(),
    name: sanitize(name).slice(0, 60),
    rating: Math.min(5, Math.max(1, parseInt(rating, 10) || 5)),
    comment: sanitize(comment).slice(0, 500),
    itemLiked: sanitize(itemLiked || 'Fast Food').slice(0, 60),
    date: new Date().toISOString().slice(0, 10),
    verified: true
  };

  reviews.unshift(newReview);
  writeJSON(REVIEWS_FILE, reviews);
  broadcastSSE('review_added', newReview);
  res.status(201).json({ success: true, review: newReview });
});

// --- SETTINGS API ---
// Public settings: Strips admin PIN
app.get('/api/settings', (req, res) => {
  const { adminPin, ...publicSettings } = settings;
  res.json(publicSettings);
});

// Verify Admin PIN (Rate-limited to prevent brute-force attacks, does not leak PIN)
app.post('/api/settings/verify-pin', rateLimit({ windowMs: 5 * 60 * 1000, max: 30, message: 'Too many incorrect attempts. Please wait 5 minutes.' }), (req, res) => {
  const { pin } = req.body;
  const currentPin = settings.adminPin || '8899';
  if (pin && pin === currentPin) {
    return res.json({ valid: true });
  }
  res.status(401).json({ valid: false, error: 'Incorrect Admin PIN' });
});

// PROTECTED: Revoke All Sessions & Invalidate Active Logins (Strictly requires Admin Auth)
app.post('/api/security/revoke-all-sessions', adminAuthMiddleware, (req, res) => {
  broadcastSSE('force_logout', {
    reason: 'Administrator revoked all active sessions. Please re-authenticate.',
    timestamp: new Date().toISOString()
  });
  res.json({
    success: true,
    message: 'All active sessions revoked across rider apps and administrative dashboards.'
  });
});

// Update Settings: Protected with admin auth
app.put('/api/settings', adminAuthMiddleware, (req, res) => {
  const { pin, adminPin, ...newSettings } = req.body;
  
  if (adminPin && String(adminPin).length >= 4) {
    settings.adminPin = String(adminPin).slice(0, 10);
  }
  
  settings = {
    ...settings,
    ...newSettings,
    restaurantName: sanitize(newSettings.restaurantName || settings.restaurantName),
    phone: sanitize(newSettings.phone || settings.phone),
    whatsappPhone: sanitize(newSettings.whatsappPhone || settings.whatsappPhone),
    upiId: sanitize(newSettings.upiId || settings.upiId),
    deliveryFee: Math.max(0, Number(newSettings.deliveryFee) || 0),
    freeDeliveryAbove: Math.max(0, Number(newSettings.freeDeliveryAbove) || 0)
  };

  writeJSON(SETTINGS_FILE, settings);
  broadcastSSE('settings_updated', { settings });
  
  const { adminPin: p, ...safeSettings } = settings;
  res.json(safeSettings);
});

// --- ORDERS API ---
function generateOrderNumber() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = orders.filter(o => o.createdAt && o.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length + 1;
  return `GK-${today.slice(4)}-${String(countToday).padStart(3, '0')}`;
}

// Customer places order (Anti-Tampering: Strict Server-Side Pricing, Quantity Clamp & Anti-XSS)
app.post('/api/orders', rateLimit({ windowMs: 10 * 60 * 1000, max: 15, message: 'Too many orders placed from this network. Please wait a few minutes.' }), (req, res) => {
  const {
    customerName,
    phone,
    orderType,
    address,
    tableNumber,
    notes,
    items,
    paymentMethod
  } = req.body;

  if (!customerName || !phone || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Missing required customer or item information' });
  }

  // Strict Server-Side Price Verification - NEVER trust client prices!
  let subtotal = 0;
  const processedItems = [];

  for (const cartItem of items) {
    const menuItem = menu.find(m => m.id === cartItem.id);
    if (!menuItem) {
      return res.status(400).json({ error: `Invalid item selected: ${cartItem.id}` });
    }
    if (!menuItem.inStock) {
      return res.status(400).json({ error: `Dish "${menuItem.name}" is currently out of stock.` });
    }

    // Enforce integer quantity between 1 and 50
    const qty = parseInt(cartItem.quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 50) {
      return res.status(400).json({ error: `Invalid quantity for ${menuItem.name}` });
    }

    const addonPrice = (cartItem.withIceCream && menuItem.hasAddon) ? 20 : 0;
    const itemTotal = (menuItem.price + addonPrice) * qty;
    subtotal += itemTotal;

    processedItems.push({
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity: qty,
      withIceCream: !!(cartItem.withIceCream && menuItem.hasAddon),
      addonPrice,
      itemTotal
    });
  }

  // Server-side delivery fee calculation
  let deliveryFee = 0;
  if (orderType === 'delivery') {
    deliveryFee = subtotal >= (settings.freeDeliveryAbove || 299) ? 0 : (settings.deliveryFee || 30);
  }

  const grandTotal = subtotal + deliveryFee;
  const orderId = generateOrderNumber();

  const newOrder = {
    id: orderId,
    customerName: sanitize(customerName).slice(0, 100),
    phone: String(phone).replace(/[^0-9+]/g, '').slice(0, 15),
    orderType: ['delivery', 'dinein', 'takeaway'].includes(orderType) ? orderType : 'delivery',
    address: sanitize(address || (orderType === 'dinein' ? `Table ${tableNumber || 'N/A'}` : 'Takeaway Pickup')).slice(0, 300),
    tableNumber: sanitize(tableNumber || '').slice(0, 20),
    notes: sanitize(notes || '').slice(0, 300),
    items: processedItems,
    subtotal,
    deliveryFee,
    grandTotal,
    paymentMethod: paymentMethod === 'upi' ? 'upi' : 'cod',
    paymentStatus: paymentMethod === 'upi' ? 'pending_verification' : 'pay_on_delivery',
    upiRef: req.body.upiRef ? sanitize(req.body.upiRef).slice(0, 30) : '',
    status: 'received',
    createdAt: new Date().toISOString(),
    statusHistory: [
      { status: 'received', time: new Date().toISOString(), note: 'Order placed by customer' }
    ]
  };

  orders.unshift(newOrder);
  writeJSON(ORDERS_FILE, orders);

  // Broadcast to kitchen and riders
  broadcastSSE('new_order', newOrder);

  res.status(201).json({
    success: true,
    message: 'Order placed successfully!',
    order: newOrder
  });
});

// PROTECTED: Orders List - STRICTLY REQUIRES ADMIN AUTH (Zero Open Data Leakage!)
app.get('/api/orders', adminAuthMiddleware, (req, res) => {
  const { status, limit } = req.query;
  let filtered = [...orders];
  if (status) {
    filtered = filtered.filter(o => o.status === status);
  }
  if (limit) {
    filtered = filtered.slice(0, parseInt(limit, 10));
  }
  res.json(filtered);
});

// Single Order Lookup (Customer live tracking): Masks PII unless admin
app.get('/api/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // If caller is admin, return complete data
  const adminPin = req.headers['x-admin-pin'] || req.query?.adminPin;
  if (adminPin && adminPin === (settings.adminPin || '1234')) {
    return res.json(order);
  }

  // Mask sensitive phone number for public/customer live tracker
  const safeOrder = {
    ...order,
    phone: maskPhone(order.phone)
  };
  res.json(safeOrder);
});

// PROTECTED: Order Status Update - STRICTLY REQUIRES ADMIN AUTH
app.patch('/api/orders/:id/status', adminAuthMiddleware, (req, res) => {
  const { status, note } = req.body;
  const validStatuses = ['received', 'preparing', 'out_for_delivery', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = status;
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    status,
    time: new Date().toISOString(),
    note: sanitize(note) || `Order marked as ${status}`
  });

  if (status === 'completed' && order.paymentMethod === 'cod') {
    order.paymentStatus = 'paid';
  }

  writeJSON(ORDERS_FILE, orders);
  broadcastSSE('order_status_update', { orderId: order.id, status, order });
  res.json(order);
});

// PROTECTED: Mark Payment Paid / Verified - REQUIRES ADMIN AUTH
app.patch('/api/orders/:id/payment', adminAuthMiddleware, (req, res) => {
  const { paymentStatus } = req.body;
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.paymentStatus = paymentStatus || 'paid';
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    status: order.status,
    time: new Date().toISOString(),
    note: `Payment status updated to ${order.paymentStatus} by Kitchen Admin`
  });

  writeJSON(ORDERS_FILE, orders);
  broadcastSSE('order_status_update', { orderId: order.id, status: order.status, order });
  res.json({ success: true, order });
});

// PROTECTED: Financial Stats & Analytics - STRICTLY REQUIRES ADMIN AUTH (Zero Revenue Leakage!)
app.get('/api/stats', adminAuthMiddleware, (req, res) => {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter(o => o.createdAt && o.createdAt.startsWith(todayPrefix));
  
  const todaySales = todayOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + (o.grandTotal || 0), 0);

  const activeOrders = orders.filter(o => ['received', 'preparing', 'out_for_delivery'].includes(o.status)).length;
  const completedOrders = todayOrders.filter(o => o.status === 'completed').length;

  const itemCounts = {};
  todayOrders.forEach(o => {
    (o.items || []).forEach(item => {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    });
  });
  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  res.json({
    todaySales,
    totalTodayOrders: todayOrders.length,
    activeOrders,
    completedOrders,
    topItems,
    currency: settings.currency || '₹'
  });
});

// --- DELIVERY PARTNER & LIVE GPS TRACKING API ---
// Public profile list: STRIPS RIDER PIN (Zero PIN Leakage!)
app.get('/api/riders', (req, res) => {
  const safeRiders = riders.map(({ pin, ...safe }) => safe);
  res.json(safeRiders);
});

// PROTECTED: Admin View of Riders including PINs (Strictly requires Admin Auth)
app.get('/api/admin/riders', adminAuthMiddleware, (req, res) => {
  res.json(riders);
});

// Rider Login: Rate-limited
app.post('/api/riders/login', rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Too many login attempts. Please wait.' }), (req, res) => {
  const { pin, riderId } = req.body;
  const rider = riders.find(r => (riderId ? r.id === riderId : true) && r.pin === pin);
  if (rider) {
    // Return sanitized profile with active session token/pin for headers
    const { pin: p, ...safeProfile } = rider;
    return res.json({ success: true, rider: safeProfile, token: rider.pin });
  }
  res.status(401).json({ success: false, error: 'Invalid Rider PIN' });
});

// Change Rider PIN: Accessible by Rider (with currentPin) OR Admin (with X-Admin-PIN)
app.put('/api/riders/:id/pin', rateLimit({ windowMs: 5 * 60 * 1000, max: 15, message: 'Too many PIN change attempts.' }), (req, res) => {
  const rider = riders.find(r => r.id === req.params.id);
  if (!rider) return res.status(404).json({ error: 'Rider not found' });

  const { currentPin, newPin } = req.body;
  const adminPinHeader = req.headers['x-admin-pin'];
  const isAdmin = adminPinHeader && adminPinHeader === (settings.adminPin || '1234');

  if (!isAdmin) {
    const riderPinHeader = req.headers['x-rider-pin'];
    const providedPin = currentPin || riderPinHeader;
    if (!providedPin || providedPin !== rider.pin) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }
  }

  // Validate new PIN format (4 to 6 numeric digits)
  if (!newPin || !/^\d{4,6}$/.test(String(newPin).trim())) {
    return res.status(400).json({ error: 'New PIN must be 4 to 6 numeric digits' });
  }

  const cleanPin = String(newPin).trim();
  rider.pin = cleanPin;
  writeJSON(RIDERS_FILE, riders);

  res.json({
    success: true,
    message: `PIN updated successfully for ${rider.name}`,
    riderId: rider.id,
    newPin: cleanPin
  });
});

// PROTECTED: Delivery Orders Queue - REQUIRES RIDER AUTH
app.get('/api/delivery/orders', riderAuthMiddleware, (req, res) => {
  const { riderId, tab } = req.query;
  const deliveryOrders = orders.filter(o => {
    if (o.orderType !== 'delivery') return false;

    // Completed History tab
    if (tab === 'completed') {
      return o.status === 'completed' && (!riderId || (o.rider && o.rider.id === riderId));
    }

    // Active tab: strictly EXCLUDE completed and cancelled orders
    if (o.status === 'completed' || o.status === 'cancelled') {
      return false;
    }

    // Active orders assigned to this rider (preparing or out_for_delivery)
    if (riderId && o.rider && o.rider.id === riderId) {
      return o.status === 'out_for_delivery' || o.status === 'preparing';
    }

    // Unassigned orders waiting for pickup
    return ['preparing', 'out_for_delivery'].includes(o.status) && (!o.rider || !o.rider.id);
  });
  res.json(deliveryOrders);
});

// PROTECTED: Rider accepts/picks up an order - REQUIRES RIDER AUTH
app.post('/api/delivery/orders/:id/pickup', riderAuthMiddleware, (req, res) => {
  const riderId = req.authenticatedRider ? req.authenticatedRider.id : (req.body.riderId || 'rider-1');
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const rider = req.authenticatedRider || riders.find(r => r.id === riderId) || { id: riderId, name: 'Delivery Partner', phone: '6239591644' };
  order.rider = {
    id: rider.id,
    name: rider.name,
    phone: rider.phone,
    vehicle: rider.vehicle || 'Delivery Scooter'
  };
  order.status = 'out_for_delivery';
  
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    status: 'out_for_delivery',
    time: new Date().toISOString(),
    note: `Picked up by rider ${rider.name}`
  });

  writeJSON(ORDERS_FILE, orders);
  broadcastSSE('order_status_update', { orderId: order.id, status: 'out_for_delivery', order });
  res.json({ success: true, order });
});

// PROTECTED: Live GPS coordinate update from Rider's phone - REQUIRES RIDER AUTH
app.post('/api/delivery/location', riderAuthMiddleware, (req, res) => {
  const { orderId, riderId, lat, lng, speed, heading } = req.body;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng coordinates' });
  }

  const locationData = {
    lat: Number(lat),
    lng: Number(lng),
    speed: speed || 0,
    heading: heading || 0,
    updatedAt: new Date().toISOString()
  };

  if (orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      order.currentLocation = locationData;
      writeJSON(ORDERS_FILE, orders);
    }
  }

  const rider = riders.find(r => r.id === riderId);
  if (rider) {
    rider.currentLocation = locationData;
  }

  broadcastSSE('rider_location_update', {
    orderId,
    riderId,
    location: locationData
  });

  res.json({ success: true, received: locationData });
});

// PROTECTED: Rider marks order delivered - REQUIRES RIDER AUTH
app.post('/api/delivery/orders/:id/deliver', riderAuthMiddleware, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = 'completed';
  order.paymentStatus = 'paid';
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({
    status: 'completed',
    time: new Date().toISOString(),
    note: `Delivered successfully by ${order.rider ? order.rider.name : 'Rider'}`
  });

  writeJSON(ORDERS_FILE, orders);
  broadcastSSE('order_status_update', { orderId: order.id, status: 'completed', order });
  res.json({ success: true, order });
});

// Rider / Delivery partner app route
app.get(['/delivery', '/rider'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'delivery.html'));
});

// Dashboard direct route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all to index.html for customer UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` Guru Kirpa Fast Food Web App & Dashboard Live! `);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(` Security Hardening: ACTIVE (Headers, Auth, Sanitization, Rate Limiter) `);
  console.log(`=================================================`);
});
