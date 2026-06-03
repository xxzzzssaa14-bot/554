// script.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyClhb_-h8A25NcRkt7q-Jm15HkIQX2NoEs",
    authDomain: "kiui-3527b.firebaseapp.com",
    projectId: "kiui-3527b",
    storageBucket: "kiui-3527b.firebasestorage.app",
    messagingSenderId: "174501891120",
    appId: "1:174501891120:web:aa6a83eb7c776f88aa71f5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentInventory = 1;
let currentRentInventory = 1; 
let currentCustomerId = null;
let isOnline = navigator.onLine;

let data = {
    inventory1: [],
    inventory2: [],
    customers: [],
    transactions: [],
    lastSync: 0
};

let syncQueue = [];

const DB_NAME = 'kareemDB';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) {
                db.createObjectStore('store');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getLocalData(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function setLocalData(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        const store = tx.objectStore('store');
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function initData() {
    const localData = await getLocalData('kareemData');
    const localQueue = await getLocalData('syncQueue');
    if (localData) data = localData;
    if (localQueue) syncQueue = localQueue;
    
    if (isOnline) {
        await processQueue();
        await syncData();
    } else {
        updateNetworkStatus('offline');
        renderUI();
    }
}

async function saveDataLocally() {
    data.lastUpdated = Date.now();
    await setLocalData('kareemData', data);
    if (isOnline) {
        await processQueue();
    }
}

function addToQueue(action, collection, item) {
    syncQueue.push({ 
        id: Date.now() + Math.random(), 
        action: action, 
        collection: collection, 
        item: JSON.parse(JSON.stringify(item)), 
        timestamp: Date.now() 
    });
    setLocalData('syncQueue', syncQueue);
}

async function processQueue() {
    if (!isOnline || syncQueue.length === 0) return;
    updateNetworkStatus('syncing');
    try {
        const docRef = doc(db, "data", "main");
        const docSnap = await getDoc(docRef);
        let serverData = { inventory1: [], inventory2: [], customers: [], transactions: [] };
        
        if (docSnap.exists()) {
            serverData = docSnap.data();
        }

        for (const op of syncQueue) {
            if (!serverData[op.collection]) serverData[op.collection] = [];
            
            if (op.action === 'add' || op.action === 'edit' || op.action === 'delete') {
                const idx = serverData[op.collection].findIndex(x => x.id === op.item.id);
                if (idx > -1) {
                    if(!serverData[op.collection][idx].lastUpdated || op.item.lastUpdated > serverData[op.collection][idx].lastUpdated) {
                        serverData[op.collection][idx] = op.item;
                    }
                } else {
                    serverData[op.collection].push(op.item);
                }
            }
        }

        await setDoc(docRef, serverData);
        syncQueue = [];
        await setLocalData('syncQueue', syncQueue);
        
        mergeData(serverData);
        updateNetworkStatus('online');
        renderUI();
    } catch (e) {
        console.error(e);
        updateNetworkStatus('offline');
    }
}

async function syncData() {
    if (syncQueue.length > 0) {
        await processQueue();
        return;
    }
    updateNetworkStatus('syncing');
    try {
        const docRef = doc(db, "data", "main");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const serverData = docSnap.data();
            mergeData(serverData);
        }
        
        updateNetworkStatus('online');
        renderUI();
    } catch (e) {
        updateNetworkStatus('offline');
    }
}

function mergeData(serverData) {
    const mergeArray = (localArr, serverArr) => {
        const map = new Map();
        if(serverArr) serverArr.forEach(item => map.set(item.id, item));
        if(localArr) localArr.forEach(item => {
            if (!map.has(item.id) || (item.lastUpdated && map.get(item.id).lastUpdated && item.lastUpdated > map.get(item.id).lastUpdated)) {
                map.set(item.id, item);
            }
        });
        return Array.from(map.values());
    };

    data.inventory1 = mergeArray(data.inventory1 || [], serverData.inventory1 || []);
    data.inventory2 = mergeArray(data.inventory2 || [], serverData.inventory2 || []);
    data.customers = mergeArray(data.customers || [], serverData.customers || []);
    data.transactions = mergeArray(data.transactions || [], serverData.transactions || []);
    data.lastSync = Date.now();
    setLocalData('kareemData', data);
}

function updateNetworkStatus(status) {
    const el = document.getElementById('network-status');
    el.className = `network-status ${status}`;
    if (status === 'online') el.innerHTML = '<i class="fa-solid fa-wifi"></i> متصل';
    if (status === 'offline') el.innerHTML = '<i class="fa-solid fa-plane-slash"></i> غير متصل';
    if (status === 'syncing') el.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> المزامنة...';
}

window.addEventListener('online', () => { isOnline = true; processQueue(); });
window.addEventListener('offline', () => { isOnline = false; updateNetworkStatus('offline'); });

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js');
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-prompt').style.display = 'block';
});

window.installApp = function() {
    document.getElementById('install-prompt').style.display = 'none';
    if(deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
};

window.closeInstallPrompt = function() {
    document.getElementById('install-prompt').style.display = 'none';
};

function formatIQD(number) {
    return new Intl.NumberFormat('en-IQ').format(number);
}

window.checkPassword = function() {
    const pass = document.getElementById('password-input').value;
    if (pass === "1001") {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('main-app').classList.add('active');
        window.switchTab('tab-customers'); 
    } else {
        alert("كلمة المرور خاطئة");
    }
}

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    document.getElementById(tabId.replace('tab-', 'nav-')).classList.add('active');

    if(tabId === 'tab-inventory') {
        document.getElementById('search-inventory').value = '';
        window.renderInventory();
    }
    if(tabId === 'tab-customers') {
        document.getElementById('search-customer').value = '';
        document.getElementById('customers-main-view').style.display = 'block';
        document.getElementById('customer-details-view').style.display = 'none';
        window.renderCustomers();
    }
    if(tabId === 'tab-alerts') {
        document.getElementById('search-alerts').value = '';
        window.renderAlerts();
    }
}

window.openModal = function(modalId) {
    document.getElementById(modalId).classList.add('active');
}
window.closeModal = function(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

window.switchInventory = function(num) {
    currentInventory = num;
    document.getElementById('btn-inv-1').classList.remove('active');
    document.getElementById('btn-inv-2').classList.remove('active');
    document.getElementById(`btn-inv-${num}`).classList.add('active');
    document.getElementById('current-inv-label').innerText = num;
    document.getElementById('search-inventory').value = ''; 
    window.renderInventory();
}

window.saveItem = async function() {
    const name = document.getElementById('item-name').value;
    const price = parseFloat(document.getElementById('item-price').value);
    const qty = parseInt(document.getElementById('item-qty').value);

    if (!name || isNaN(price) || isNaN(qty)) {
        alert("يرجى تعبئة جميع الحقول بشكل صحيح"); return;
    }

    const newItem = { id: Date.now(), name, price, qty, isDeleted: false, lastUpdated: Date.now() };
    const collection = currentInventory === 1 ? 'inventory1' : 'inventory2';
    
    data[collection].push(newItem);
    addToQueue('add', collection, newItem);

    await saveDataLocally();
    window.closeModal('addItemModal');
    
    document.getElementById('item-name').value = '';
    document.getElementById('item-price').value = '';
    document.getElementById('item-qty').value = '';
    
    window.renderInventory();
}

let inventorySearchTimeout;
window.searchInventory = function() {
    clearTimeout(inventorySearchTimeout);
    inventorySearchTimeout = setTimeout(() => {
        const query = document.getElementById('search-inventory').value.toLowerCase().trim();
        window.renderInventory(query);
    }, 300);
}

window.openEditModal = function(id, invNum) {
    const items = invNum === 1 ? data.inventory1 : data.inventory2;
    const item = items.find(i => i.id === id);

    if (item) {
        document.getElementById('edit-item-id').value = id;
        document.getElementById('edit-item-inv').value = invNum;
        document.getElementById('edit-item-name').value = item.name;
        document.getElementById('edit-item-price').value = item.price;
        document.getElementById('edit-item-qty').value = item.qty;
        
        window.openModal('editItemModal');
    }
}

window.saveEditItem = async function() {
    const id = parseInt(document.getElementById('edit-item-id').value);
    const invNum = parseInt(document.getElementById('edit-item-inv').value);
    const name = document.getElementById('edit-item-name').value;
    const price = parseFloat(document.getElementById('edit-item-price').value);
    const qty = parseInt(document.getElementById('edit-item-qty').value);

    if (!name || isNaN(price) || isNaN(qty)) {
        alert("يرجى تعبئة جميع الحقول بشكل صحيح"); return;
    }

    const collection = invNum === 1 ? 'inventory1' : 'inventory2';
    const items = data[collection];
    const itemIndex = items.findIndex(i => i.id === id);

    if (itemIndex > -1) {
        items[itemIndex].name = name;
        items[itemIndex].price = price;
        items[itemIndex].qty = qty;
        items[itemIndex].lastUpdated = Date.now();
        
        addToQueue('edit', collection, items[itemIndex]);
        await saveDataLocally();
        window.closeModal('editItemModal');
        
        const query = document.getElementById('search-inventory').value.toLowerCase().trim();
        window.renderInventory(query);
    }
}

window.deleteItem = async function(id, invNum) {
    if(confirm("هل أنت متأكد من حذف هذه المادة؟")) {
        const collection = invNum === 1 ? 'inventory1' : 'inventory2';
        const itemIndex = data[collection].findIndex(i => i.id === id);
        if(itemIndex > -1) {
            data[collection][itemIndex].isDeleted = true;
            data[collection][itemIndex].lastUpdated = Date.now();
            addToQueue('edit', collection, data[collection][itemIndex]);
            await saveDataLocally();
            
            const query = document.getElementById('search-inventory').value.toLowerCase().trim();
            window.renderInventory(query);
        }
    }
}

window.renderInventory = function(searchQuery = '') {
    const list = document.getElementById('inventory-list');
    let html = '';
    let items = currentInventory === 1 ? data.inventory1 : data.inventory2;
    
    items = items.filter(item => !item.isDeleted);

    if (searchQuery) {
        items = items.filter(item => item.name.toLowerCase().startsWith(searchQuery));
    }

    if(items.length === 0 && searchQuery !== '') {
        list.innerHTML = '<p style="text-align:center; color:#fff; font-weight:bold; padding: 20px;">لا توجد مواد تطابق بحثك.</p>';
        return;
    }

    items.forEach(item => {
        html += `
            <div class="card">
                <div class="card-info">
                    <h4><i class="fa-solid fa-wrench"></i> ${item.name}</h4>
                    <p>السعر: ${formatIQD(item.price)} د.ع</p>
                    <p>الكمية المتوفرة: ${item.qty}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-warning btn-small" onclick="window.openEditModal(${item.id}, ${currentInventory})"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-danger btn-small" onclick="window.deleteItem(${item.id}, ${currentInventory})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    });
    
    list.innerHTML = html;
}

let customerSearchTimeout;
window.searchCustomer = function() {
    clearTimeout(customerSearchTimeout);
    customerSearchTimeout = setTimeout(() => {
        const query = document.getElementById('search-customer').value.toLowerCase().trim();
        window.renderCustomers(query);
    }, 300);
}

let alertsSearchTimeout;
window.searchAlerts = function() {
    clearTimeout(alertsSearchTimeout);
    alertsSearchTimeout = setTimeout(() => {
        const query = document.getElementById('search-alerts').value.toLowerCase().trim();
        window.renderAlerts(query);
    }, 300);
}

window.saveCustomer = async function() {
    const name = document.getElementById('cust-name').value;
    const phone = document.getElementById('cust-phone').value;

    if (!name || !phone) { alert("يرجى إدخال الاسم والرقم"); return; }

    const newCustomer = {
        id: Date.now(),
        name: name,
        phone: "964" + phone,
        balance: 0,
        isDeleted: false,
        lastUpdated: Date.now()
    };

    data.customers.push(newCustomer);
    addToQueue('add', 'customers', newCustomer);

    await saveDataLocally();
    window.closeModal('addCustomerModal');
    
    document.getElementById('cust-name').value = '';
    document.getElementById('cust-phone').value = '';
    
    const query = document.getElementById('search-customer').value.toLowerCase().trim();
    window.renderCustomers(query);
}

window.openEditCustomerModal = function(id) {
    const customer = data.customers.find(c => c.id === id);
    if (customer) {
        document.getElementById('edit-cust-id').value = customer.id;
        document.getElementById('edit-cust-name').value = customer.name;
        document.getElementById('edit-cust-phone').value = customer.phone.replace(/^964/, ''); 
        
        window.openModal('editCustomerModal');
    }
}

window.saveEditCustomer = async function() {
    const id = parseInt(document.getElementById('edit-cust-id').value);
    const name = document.getElementById('edit-cust-name').value;
    const phone = document.getElementById('edit-cust-phone').value;

    if (!name || !phone) { alert("يرجى إدخال الاسم والرقم"); return; }

    const customerIndex = data.customers.findIndex(c => c.id === id);
    if (customerIndex > -1) {
        data.customers[customerIndex].name = name;
        data.customers[customerIndex].phone = "964" + phone;
        data.customers[customerIndex].lastUpdated = Date.now();
        
        addToQueue('edit', 'customers', data.customers[customerIndex]);

        await saveDataLocally();
        window.closeModal('editCustomerModal');
        
        const query = document.getElementById('search-customer').value.toLowerCase().trim();
        window.renderCustomers(query);
    }
}

window.renderCustomers = function(searchQuery = '') {
    const list = document.getElementById('customers-list');
    let html = '';
    
    let filteredCustomers = data.customers.filter(c => !c.isDeleted);
    if(searchQuery) {
        filteredCustomers = filteredCustomers.filter(cust => cust.name.toLowerCase().startsWith(searchQuery));
    }

    filteredCustomers.forEach(cust => {
        html += `
            <div class="card" onclick="window.openCustomerDetails(${cust.id})">
                <div class="card-info">
                    <h4><i class="fa-solid fa-user"></i> ${cust.name}</h4>
                    <p><i class="fa-solid fa-phone"></i> +${cust.phone}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-warning btn-small" onclick="event.stopPropagation(); window.openEditCustomerModal(${cust.id})"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-danger btn-small" onclick="event.stopPropagation(); window.deleteCustomer(${cust.id})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    });
    
    list.innerHTML = html;
}

window.deleteCustomer = async function(id) {
    if(confirm("هل أنت متأكد من حذف هذا الزبون؟")) {
        const customerIndex = data.customers.findIndex(c => c.id === id);
        if (customerIndex > -1) {
            data.customers[customerIndex].isDeleted = true;
            data.customers[customerIndex].lastUpdated = Date.now();
            addToQueue('edit', 'customers', data.customers[customerIndex]);
            await saveDataLocally();
            
            const query = document.getElementById('search-customer').value.toLowerCase().trim();
            window.renderCustomers(query);
        }
    }
}

window.openCustomerDetails = function(id) {
    currentCustomerId = id;
    const customer = data.customers.find(c => c.id === id);
    
    document.getElementById('customers-main-view').style.display = 'none';
    document.getElementById('customer-details-view').style.display = 'block';
    
    document.getElementById('detail-customer-name').innerHTML = `<i class="fa-solid fa-user-tag"></i> ${customer.name}`;
    document.getElementById('detail-customer-phone').innerHTML = `<i class="fa-solid fa-phone-volume"></i> +${customer.phone}`;
    document.getElementById('detail-customer-phone').href = "tel:+" + customer.phone;

    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.backToCustomers = function() {
    document.getElementById('customers-main-view').style.display = 'block';
    document.getElementById('customer-details-view').style.display = 'none';
    currentCustomerId = null;
    
    const query = document.getElementById('search-customer').value.toLowerCase().trim();
    window.renderCustomers(query);
}

window.updateCustomerBalanceDisplay = function(customer) {
    document.getElementById('detail-customer-balance').innerText = `${formatIQD(customer.balance)} د.ع`;
}

window.savePayment = async function() {
    const amount = parseFloat(document.getElementById('payment-amount').value);
    if(isNaN(amount) || amount <= 0) return;

    const customer = data.customers.find(c => c.id === currentCustomerId);
    customer.balance -= amount;
    customer.lastUpdated = Date.now();
    
    addToQueue('edit', 'customers', customer);

    const now = new Date();
    const newTrans = {
        id: Date.now(),
        customerId: currentCustomerId,
        type: 'payment',
        amount: amount,
        isDeleted: false,
        date: now.toLocaleDateString('ar-IQ'),
        time: now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }),
        lastUpdated: Date.now()
    };

    data.transactions.push(newTrans);
    addToQueue('add', 'transactions', newTrans);

    await saveDataLocally();
    window.closeModal('paymentModal');
    document.getElementById('payment-amount').value = '';
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.changeRentInventory = function(num) {
    currentRentInventory = num;
    document.getElementById('btn-rent-inv-1').classList.remove('active');
    document.getElementById('btn-rent-inv-2').classList.remove('active');
    document.getElementById(`btn-rent-inv-${num}`).classList.add('active');
    
    const searches = document.querySelectorAll('.rent-item-search');
    searches.forEach(search => {
        search.value = '';
    });
    const prices = document.querySelectorAll('.rent-item-price');
    prices.forEach(price => {
        price.value = '0';
    });
}

window.openRentModal = function() {
    window.changeRentInventory(1);
    document.getElementById('rent-items-container').innerHTML = '';
    document.getElementById('rent-paid').value = '';
    document.getElementById('rent-days').value = '1';
    window.addRentItemRow(); 
    window.openModal('rentModal');
}

window.filterRentItems = function(input, rowId) {
    const query = input.value.toLowerCase().trim();
    const dropdown = document.getElementById(`dropdown-${rowId}`);
    let items = (currentRentInventory === 1 ? data.inventory1 : data.inventory2).filter(i => !i.isDeleted);
    
    dropdown.innerHTML = '';
    
    let filtered = items;
    if (query) {
        filtered = items.filter(item => item.name.toLowerCase().startsWith(query));
    }

    if (filtered.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    filtered.forEach(item => {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
        div.style.cursor = 'pointer';
        div.style.color = '#333';
        div.innerText = `${item.name} (${formatIQD(item.price)} د.ع)`;
        div.onclick = function() {
            input.value = item.name;
            document.getElementById(`price-${rowId}`).value = item.price;
            dropdown.style.display = 'none';
        };
        dropdown.appendChild(div);
    });
    
    dropdown.style.display = 'block';
}

document.addEventListener('click', function(e) {
    if (!e.target.classList.contains('rent-item-search')) {
        document.querySelectorAll('.rent-item-dropdown').forEach(d => d.style.display = 'none');
    }
});

window.addRentItemRow = function() {
    const container = document.getElementById('rent-items-container');
    const rowId = Date.now();
    
    const rowHTML = `
        <div class="rent-item-row" id="row-${rowId}">
            <div style="position: relative; flex: 1;">
                <input type="text" id="search-${rowId}" class="rent-item-search" placeholder="ابحث عن مادة..." onkeyup="window.filterRentItems(this, ${rowId})" onfocus="window.filterRentItems(this, ${rowId})" autocomplete="off" style="margin-bottom:0;">
                <input type="hidden" id="price-${rowId}" class="rent-item-price" value="0">
                <div id="dropdown-${rowId}" class="rent-item-dropdown" style="display:none; position:absolute; background:rgba(255,255,255,0.9); backdrop-filter:blur(10px); width:100%; border:1px solid #fff; border-radius:12px; max-height:150px; overflow-y:auto; z-index:100; top:100%; box-shadow: 0 10px 20px rgba(0,0,0,0.2);"></div>
            </div>
            <input type="number" placeholder="الكمية" value="1" min="1" class="rent-item-qty" style="width: 70px; margin-bottom:0;">
            <button class="btn-danger btn-small" onclick="document.getElementById('row-${rowId}').remove();"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHTML);
}

window.saveRentalTransaction = async function() {
    const paid = parseFloat(document.getElementById('rent-paid').value) || 0;
    const days = parseInt(document.getElementById('rent-days').value) || 1;
    const customer = data.customers.find(c => c.id === currentCustomerId);

    let itemsText = [];
    let itemsArray = [];
    let canRent = true;

    const searches = document.querySelectorAll('.rent-item-search');
    const qtys = document.querySelectorAll('.rent-item-qty');
    const prices = document.querySelectorAll('.rent-item-price');
    
    const nowTimestamp = Date.now();
    const returnDateTimestamp = nowTimestamp + (days * 86400000);

    searches.forEach((search, index) => {
        if(search.value.trim() !== '') {
            const itemName = search.value.trim();
            const qty = parseInt(qtys[index].value) || 1;
            const price = parseFloat(prices[index].value) || 0;
            
            let foundItem = data.inventory1.find(i => i.name === itemName && !i.isDeleted);
            let invType = 1;
            if(!foundItem) {
                foundItem = data.inventory2.find(i => i.name === itemName && !i.isDeleted);
                invType = 2;
            }

            if(foundItem) {
                if(foundItem.qty < qty) {
                    canRent = false;
                } else {
                    itemsArray.push({
                        id: foundItem.id,
                        name: foundItem.name,
                        qty: qty,
                        price: price,
                        invType: invType,
                        returnedQty: 0,
                        rentTimestamp: nowTimestamp
                    });
                    itemsText.push(`${itemName} (عدد ${qty})`);
                }
            } else {
                 canRent = false;
            }
        }
    });

    if(!canRent) {
        alert("المخزون لا يكفي أو المادة غير موجودة!");
        return;
    }

    itemsArray.forEach(item => {
        let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
        let invItem = data[collection].find(i => i.id === item.id);
        if(invItem) { 
            invItem.qty -= item.qty; 
            invItem.lastUpdated = nowTimestamp; 
            addToQueue('edit', collection, invItem);
        }
    });

    customer.balance -= paid;
    customer.lastUpdated = nowTimestamp;
    addToQueue('edit', 'customers', customer);

    const now = new Date();
    const rawDate = now.toISOString().split('T')[0];
    const rawTime = now.toTimeString().slice(0, 5);

    const transaction = {
        id: nowTimestamp,
        customerId: currentCustomerId,
        type: 'rent',
        items: itemsText.join(' + '),
        itemsArray: itemsArray,
        days: days,
        returnDateTimestamp: returnDateTimestamp,
        totalCost: 0,
        paid: paid,
        isDeleted: false,
        date: now.toLocaleDateString('ar-IQ'),
        time: now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true }),
        rawDate: rawDate,
        rawTime: rawTime,
        status: 'ongoing',
        returnHistory: [],
        lastUpdated: nowTimestamp
    };

    data.transactions.push(transaction);
    addToQueue('add', 'transactions', transaction);

    await saveDataLocally();
    window.closeModal('rentModal');
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
    
    const query = document.getElementById('search-inventory').value.toLowerCase().trim();
    window.renderInventory(query);
}

window.deleteTransaction = async function(id) {
    if(confirm("هل أنت متأكد من حذف هذه المعاملة؟ سيتم التراجع عن تأثيرها في حساب الزبون.")) {
        const transIndex = data.transactions.findIndex(t => t.id === id);
        const trans = data.transactions[transIndex];
        const customer = data.customers.find(c => c.id === trans.customerId);
        
        if (trans.type === 'rent') {
            let netImpact = (trans.totalCost || 0) - (trans.paid || 0);
            if(trans.remaining !== undefined) netImpact = trans.remaining;
            customer.balance -= netImpact;

            if(trans.itemsArray) {
                trans.itemsArray.forEach(item => {
                    const unreturnedQty = item.qty - (item.returnedQty || 0);
                    if(unreturnedQty > 0) {
                        let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
                        let invItem = data[collection].find(i => i.id === item.id);
                        if(invItem) {
                            invItem.qty += unreturnedQty;
                            invItem.lastUpdated = Date.now();
                            addToQueue('edit', collection, invItem);
                        }
                    }
                });
            }
        } else if (trans.type === 'payment') {
            customer.balance += trans.amount; 
        }
        
        customer.lastUpdated = Date.now();
        addToQueue('edit', 'customers', customer);

        data.transactions[transIndex].isDeleted = true;
        data.transactions[transIndex].lastUpdated = Date.now();
        addToQueue('edit', 'transactions', data.transactions[transIndex]);

        await saveDataLocally();
        window.updateCustomerBalanceDisplay(customer);
        window.renderTransactions();
        
        const query = document.getElementById('search-inventory').value.toLowerCase().trim();
        window.renderInventory(query);
    }
}

window.openEditTransactionModal = function(id) {
    const trans = data.transactions.find(t => t.id === id);
    if(trans && trans.type === 'rent') {
        document.getElementById('edit-trans-id').value = id;
        document.getElementById('edit-trans-items').value = trans.items || (trans.itemsArray ? trans.itemsArray.map(i=>`${i.name}(${i.qty})`).join(', ') : '');
        document.getElementById('edit-trans-date').value = trans.rawDate || '';
        document.getElementById('edit-trans-time').value = trans.rawTime || '';
        document.getElementById('edit-trans-days').value = trans.days || 1;
        document.getElementById('edit-trans-total').value = trans.total || trans.totalCost || 0;
        document.getElementById('edit-trans-paid').value = trans.paid || 0;
        window.openModal('editTransactionModal');
    }
}

window.updateEditTotal = function() {
    // لم نعد نحسب التكلفة التلقائية هنا لمنع تداخل أسعار الإرجاع الفردي مع الإجمالي الكامل للمدة.
}

window.saveEditTransaction = async function() {
    const id = parseInt(document.getElementById('edit-trans-id').value);
    const trans = data.transactions.find(t => t.id === id);
    const customer = data.customers.find(c => c.id === trans.customerId);
    
    const newItems = document.getElementById('edit-trans-items').value;
    const newDate = document.getElementById('edit-trans-date').value;
    const newTime = document.getElementById('edit-trans-time').value;
    const newDays = parseInt(document.getElementById('edit-trans-days').value) || trans.days;
    const newTotal = parseFloat(document.getElementById('edit-trans-total').value) || 0;
    const newPaid = parseFloat(document.getElementById('edit-trans-paid').value) || 0;
    
    let oldNet = trans.remaining !== undefined ? trans.remaining : ((trans.totalCost||0) - (trans.paid||0));
    customer.balance -= oldNet;
    
    trans.items = newItems;
    if(newDate) { trans.rawDate = newDate; trans.date = newDate; }
    if(newTime) { trans.rawTime = newTime; trans.time = newTime; }
    trans.days = newDays;
    trans.returnDateTimestamp = trans.id + (newDays * 86400000); 
    trans.total = newTotal;
    trans.totalCost = newTotal; 
    trans.paid = newPaid;
    trans.remaining = trans.totalCost - trans.paid;
    
    customer.balance += trans.remaining;
    
    trans.lastUpdated = Date.now();
    customer.lastUpdated = Date.now();

    addToQueue('edit', 'transactions', trans);
    addToQueue('edit', 'customers', customer);

    await saveDataLocally();
    window.closeModal('editTransactionModal');
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
}

window.updateReturnCost = function(index, price, days) {
    const qty = parseInt(document.getElementById(`ret-qty-${index}`).value) || 0;
    const cost = days * price * qty;
    document.getElementById(`est-cost-${index}`).innerText = formatIQD(cost);
}

window.openReturnModal = function(id) {
    document.getElementById('return-trans-id').value = id;
    const trans = data.transactions.find(t => t.id === id);
    const container = document.getElementById('return-items-container');
    container.innerHTML = '';
    const now = Date.now();

    if(trans.itemsArray && trans.itemsArray.length > 0) {
        trans.itemsArray.forEach((item, index) => {
            const pendingQty = item.qty - (item.returnedQty || 0);
            if(pendingQty > 0) {
                const days = Math.max(1, Math.ceil((now - item.rentTimestamp) / 86400000));
                const estimatedCost = days * item.price * pendingQty;
                
                let html = `
                    <div class="rent-item-row" style="flex-direction:column; align-items:start; gap:5px;">
                        <div style="font-weight:bold; color:#fff;">${item.name} (الكمية الكلية: ${item.qty} | المتبقي للإرجاع: ${pendingQty})</div>
                        <div style="font-size:12px; color:rgba(255,255,255,0.8);">الأيام المحسوبة: ${days} يوم | الإيجار الكلي للكمية المحددة بالأسفل: <span id="est-cost-${index}" style="font-weight:bold; color:#ffd700;">${formatIQD(estimatedCost)}</span> د.ع</div>
                        <div style="display:flex; gap:5px; width:100%; flex-wrap:wrap; margin-top: 5px;">
                            <input type="number" id="ret-qty-${index}" placeholder="الكمية المرجعة" value="${pendingQty}" min="1" max="${pendingQty}" oninput="window.updateReturnCost(${index}, ${item.price}, ${days})" style="margin-bottom:0; flex:1; min-width:100px;">
                            <button class="btn-success btn-small" onclick="window.processSingleReturn(${id}, ${index}, true)" style="margin-bottom:0; flex:1; min-width:120px;"><i class="fa-solid fa-hand-holding-dollar"></i> إرجاع ونقد</button>
                            <button class="btn-warning btn-small" onclick="window.processSingleReturn(${id}, ${index}, false)" style="margin-bottom:0; flex:1; min-width:120px;"><i class="fa-solid fa-book"></i> إرجاع وآجل</button>
                        </div>
                    </div>
                `;
                container.innerHTML += html;
            }
        });
    } else {
        container.innerHTML = '<p style="color:#fff;">لا توجد تفاصيل مواد لهذه المعاملة القديمة.</p>';
    }

    const historyContainer = document.getElementById('return-history-container');
    historyContainer.innerHTML = '';
    
    if(trans.returnHistory && trans.returnHistory.length > 0) {
        trans.returnHistory.forEach(h => {
            historyContainer.innerHTML += `
                <div style="background: rgba(255,255,255,0.2); padding: 8px; margin-bottom: 5px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); font-size: 13px; color:#fff;">
                    <strong><i class="fa-solid fa-clock-rotate-left"></i> ${h.itemName}</strong> | تم إرجاع: ${h.qty} | التكلفة: ${formatIQD(h.cost)} | تسديد: ${h.type} | التاريخ: ${h.date}
                </div>
            `;
        });
    } else {
        historyContainer.innerHTML = '<p style="font-size: 13px; color: rgba(255,255,255,0.8);">لا توجد إرجاعات سابقة.</p>';
    }

    window.openModal('returnModal');
}

window.processSingleReturn = async function(transId, itemIndex, isCash) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    const item = trans.itemsArray[itemIndex];
    
    const qtyInput = parseInt(document.getElementById(`ret-qty-${itemIndex}`).value) || 0;
    
    if(qtyInput <= 0 || qtyInput > (item.qty - (item.returnedQty || 0))) {
        alert("الكمية غير صالحة"); return;
    }

    const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
    const cost = days * item.price * qtyInput;
    const payInput = isCash ? cost : 0;

    item.returnedQty = (item.returnedQty || 0) + qtyInput;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-IQ') + ' ' + now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });

    let collection = item.invType === 1 ? 'inventory1' : 'inventory2';
    let invItem = data[collection].find(i => i.id === item.id);
    if(invItem) {
        invItem.qty += qtyInput;
        invItem.lastUpdated = Date.now();
        addToQueue('edit', collection, invItem);
    }

    trans.totalCost = (trans.totalCost || 0) + cost;
    trans.paid += payInput;
    
    customer.balance += (cost - payInput);

    if(!trans.returnHistory) trans.returnHistory = [];
    trans.returnHistory.push({
        itemName: item.name,
        qty: qtyInput,
        cost: cost,
        paid: payInput,
        date: dateStr,
        type: isCash ? 'دفع نقدي' : 'آجل (دين)'
    });

    const allReturned = trans.itemsArray.every(i => (i.returnedQty || 0) >= i.qty);
    if(allReturned) {
        trans.status = 'completed';
    } else {
        trans.status = 'ongoing';
    }

    trans.lastUpdated = Date.now();
    customer.lastUpdated = Date.now();

    addToQueue('edit', 'transactions', trans);
    addToQueue('edit', 'customers', customer);

    await saveDataLocally();
    window.openReturnModal(transId); 
    window.updateCustomerBalanceDisplay(customer);
    window.renderTransactions();
    
    const query = document.getElementById('search-inventory').value.toLowerCase().trim();
    window.renderInventory(query);
}

window.renderTransactions = function() {
    const list = document.getElementById('transactions-list');
    let html = '';
    
    const custTrans = data.transactions.filter(t => t.customerId === currentCustomerId && !t.isDeleted).reverse();

    custTrans.forEach(t => {
        const displayTime = t.time ? t.time : ''; 
        
        if(t.type === 'payment') {
            html += `
                <div class="card" style="border-right: 5px solid #2ecc71;">
                    <div class="card-info">
                        <h4 style="color:#2ecc71; text-shadow:none;"><i class="fa-solid fa-money-bill-trend-up"></i> تسديد نقد</h4>
                        <p>المبلغ: ${formatIQD(t.amount)} د.ع | التاريخ: ${t.date} ${displayTime}</p>
                    </div>
                    <div class="card-actions">
                        <button class="btn-success btn-small" onclick="window.sharePaymentWhatsApp(${t.id})" style="margin-bottom:3px;"><i class="fa-brands fa-whatsapp"></i></button>
                        <button class="btn-danger btn-small" onclick="window.deleteTransaction(${t.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        } else {
            let itemsDisplay = '';
            let liveRunningCost = 0;
            
            if(t.itemsArray) {
                itemsDisplay = t.itemsArray.map(i => {
                    let ret = i.returnedQty || 0;
                    if(ret === 0) return `${i.name} (عدد ${i.qty})`;
                    if(ret >= i.qty) return `<span style="text-decoration:line-through; color:rgba(255,255,255,0.5);">${i.name}</span> ✔`;
                    return `${i.name} (جاري:${i.qty - ret} | مرجع:${ret})`;
                }).join(' <br> ');
                
                if(t.status !== 'completed') {
                    t.itemsArray.forEach(item => {
                        const pendingQty = item.qty - (item.returnedQty || 0);
                        if(pendingQty > 0) {
                            const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
                            liveRunningCost += days * item.price * pendingQty;
                        }
                    });
                }
            } else {
                itemsDisplay = t.items;
            }
            
            const totalDisplay = (t.totalCost || 0) + liveRunningCost;
            const remDisplay = totalDisplay - t.paid;

            html += `
                <div class="card" style="border-right: 5px solid #3498db;">
                    <div class="card-info" style="flex:1;">
                        <h4 style="font-size:16px; margin-bottom:10px;"><i class="fa-solid fa-file-contract"></i> تأجير:</h4>
                        <div style="font-size:14px; margin-bottom:10px; line-height:1.6; background:rgba(255,255,255,0.1); padding:5px; border-radius:5px;">${itemsDisplay}</div>
                        <p style="color:#ffd700;">إيجار الراجع: ${formatIQD(t.totalCost || 0)} | إيجار الجاري: ${formatIQD(liveRunningCost)}</p>
                        <p style="font-weight:bold; font-size:15px;">الإجمالي الكلي المحسوب: ${formatIQD(totalDisplay)}</p>
                        <p>المدفوع: ${formatIQD(t.paid)} | الباقي: ${formatIQD(remDisplay)}</p>
                        <p style="font-size:12px; color:rgba(255,255,255,0.7);">تاريخ: ${t.date} | الوقت: ${displayTime}</p>
                    </div>
                    <div class="card-actions" style="margin-right:10px;">
                        <button class="btn-success btn-small" onclick="window.shareRentWhatsApp(${t.id})" style="margin-bottom:3px;"><i class="fa-brands fa-whatsapp"></i></button>
                        <button class="btn-primary btn-small" onclick="window.openReturnModal(${t.id})" style="margin-bottom:3px; background:linear-gradient(135deg, #e67e22, #d35400) !important;"><i class="fa-solid fa-rotate-left"></i></button>
                        ${t.status === 'completed' ? `<span style="color: #2ecc71; font-size:14px; font-weight:bold; text-align:center; margin-bottom:5px;">مكتملة ✔</span>` : ''}
                        <button class="btn-warning btn-small" onclick="window.openEditTransactionModal(${t.id})" style="margin-bottom:3px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-danger btn-small" onclick="window.deleteTransaction(${t.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        }
    });
    
    list.innerHTML = html;
}

window.sharePaymentWhatsApp = function(transId) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    const msg = `مرحباً ${customer.name}،\nتم استلام دفعة نقدية (تسديد لحسابكم) بمبلغ: ${formatIQD(trans.amount)} د.ع.\nتاريخ الدفعة: ${trans.date} - ${trans.time}\n\nإجمالي الديون المتبقية بذمتكم حالياً هو: ${formatIQD(customer.balance)} د.ع.\n\nشكراً لتعاملكم مع محلات كريم لتأجير العدد اليدوية!`;
    const encodedMessage = encodeURIComponent(msg);
    const whatsappUrl = `https://wa.me/${customer.phone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
}

window.shareRentWhatsApp = function(transId) {
    const trans = data.transactions.find(t => t.id === transId);
    const customer = data.customers.find(c => c.id === trans.customerId);
    
    let itemsDisplay = trans.itemsArray ? trans.itemsArray.map(i => {
        let ret = i.returnedQty || 0;
        if(ret === 0) return `${i.name} (عدد ${i.qty})`;
        if(ret >= i.qty) return `${i.name} (تم الإرجاع)`;
        return `${i.name} (المتبقي ${i.qty - ret})`;
    }).join(', ') : trans.items.replace(/<[^>]*>?/gm, ' ');
    
    let liveRunningCost = 0;
    if(trans.itemsArray && trans.status !== 'completed') {
        trans.itemsArray.forEach(item => {
            const pendingQty = item.qty - (item.returnedQty || 0);
            if(pendingQty > 0) {
                const days = Math.max(1, Math.ceil((Date.now() - item.rentTimestamp) / 86400000));
                liveRunningCost += days * item.price * pendingQty;
            }
        });
    }
    
    const totalDisplay = (trans.totalCost || 0) + liveRunningCost;
    const remDisplay = totalDisplay - trans.paid;

    const message = `*محلات كريم لتأجير العدد اليدوية*\n\nمرحباً ${customer.name}،\nتفاصيل التأجير:\nالمواد: ${itemsDisplay}\nالمبلغ المحسوب حتى الآن: ${formatIQD(totalDisplay)} د.ع\nالمدفوع: ${formatIQD(trans.paid)} د.ع\nالمتبقي من هذه الفاتورة: ${formatIQD(remDisplay)} د.ع\n\nإجمالي الباقي بذمتكم: ${formatIQD(customer.balance)} د.ع\n\nشكراً لتعاملكم معنا!`;
    
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${customer.phone}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
}

window.renderAlerts = function(searchQuery = '') {
    const list = document.getElementById('alerts-list');
    let html = '';
    
    const now = Date.now();
    let hasAlerts = false;

    data.transactions.forEach(t => {
        if(t.type === 'rent' && t.status === 'ongoing' && t.returnDateTimestamp && t.returnDateTimestamp < now && !t.isDeleted) {
            const customer = data.customers.find(c => c.id === t.customerId);
            if (!customer || customer.isDeleted) return;
            
            if (searchQuery && !customer.name.toLowerCase().startsWith(searchQuery)) return;

            hasAlerts = true;
            const diffTime = Math.abs(now - t.returnDateTimestamp);
            const delayDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let itemsAlert = t.itemsArray ? t.itemsArray.filter(i => (i.returnedQty||0) < i.qty).map(i => i.name).join(' + ') : t.items.replace(/<[^>]*>?/gm, ' ');

            html += `
                <div class="card" style="border-right: 5px solid #e74c3c; background: rgba(231, 76, 60, 0.2) !important;">
                    <div class="card-info">
                        <h4 style="color:#fff;"><i class="fa-solid fa-clock"></i> تأخير: ${customer.name}</h4>
                        <p>المواد: ${itemsAlert}</p>
                        <p>مدة التأخير: ${delayDays} يوم</p>
                        <p><i class="fa-solid fa-phone"></i> +${customer.phone}</p>
                    </div>
                    <div class="card-actions">
                        <a href="https://wa.me/${customer.phone}" target="_blank" class="btn-success btn-small" style="text-decoration:none; text-align:center;"><i class="fa-brands fa-whatsapp"></i> مراسلة</a>
                    </div>
                </div>
            `;
        }
    });

    if(!hasAlerts) {
        html = '<p style="text-align:center; color:#fff; margin-top:20px; font-weight:bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">لا توجد تنبيهات حالياً.</p>';
    }
    
    list.innerHTML = html;
}

function renderUI() {
    if(document.getElementById('tab-inventory').classList.contains('active')) {
        const query = document.getElementById('search-inventory').value.toLowerCase().trim();
        window.renderInventory(query);
    }
    if(document.getElementById('tab-customers').classList.contains('active')) {
        const query = document.getElementById('search-customer').value.toLowerCase().trim();
        window.renderCustomers(query);
    }
    if(document.getElementById('customer-details-view').style.display === 'block') window.renderTransactions();
    if(document.getElementById('tab-alerts').classList.contains('active')) {
        const query = document.getElementById('search-alerts').value.toLowerCase().trim();
        window.renderAlerts(query);
    }
}

window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
}

if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
}

initData();
