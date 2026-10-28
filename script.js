// ================= CONFIG =================
// Change this password before you use the site.
// NOTE: this is front-end only, so it is a placeholder, not real security.
const OWNER_PASSWORD = "change-this-password";
const CURRENCY = "₦";
const CATEGORIES = {
    tshirts: "T-Shirts",
    trousers: "Trousers",
    hoodies: "Hoodies",
    shoes: "Shoes",
    jackets: "Jackets",
    caps: "Caps"
};

// ================= STORAGE =================
const store = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }
};

let products = store.get("shop_products", []); // {id, category, name, price, image}
let cart = store.get("shop_cart", []);         // {id, qty}
let currentCategory = "tshirts";
let isOwner = false;
try { isOwner = sessionStorage.getItem("shop_owner") === "1"; } catch (e) {}

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);
const formatPrice = (n) => CURRENCY + Number(n).toLocaleString();

function resizeImage(file, maxSize = 800) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", 0.8));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// ================= NAV / CATEGORIES =================
function renderNav() {
    const nav = $("category-nav");
    nav.innerHTML = "";
    Object.entries(CATEGORIES).forEach(([key, label]) => {
        const btn = document.createElement("button");
        btn.className = "menu-item" + (key === currentCategory ? " active" : "");
        btn.textContent = label;
        btn.onclick = () => { currentCategory = key; renderNav(); renderProducts(); };
        nav.appendChild(btn);
    });
}

function renderProducts() {
    $("category-title").textContent = CATEGORIES[currentCategory];
    const grid = $("product-grid");
    grid.innerHTML = "";
    const items = products.filter((p) => p.category === currentCategory);
    $("empty-msg").hidden = items.length > 0;

    items.forEach((p) => {
        const card = document.createElement("div");
        card.className = "product-card" + (isOwner ? " owner-card" : "");
        card.dataset.id = p.id;

        const img = document.createElement("img");
        img.src = p.image;
        img.alt = p.name;
        img.draggable = false;

        const info = document.createElement("div");
        info.className = "product-info";

        const name = document.createElement("div");
        name.className = "product-name";
        name.textContent = p.name;

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = formatPrice(p.price);

        const add = document.createElement("button");
        add.className = "primary-btn";
        add.textContent = "Add to cart";
        add.onclick = () => {
            addToCart(p.id);
            add.textContent = "Added ✓";
            setTimeout(() => { add.textContent = "Add to cart"; }, 900);
        };

        info.append(name, price, add);

        if (isOwner) {
            const actions = document.createElement("div");
            actions.className = "owner-actions";

            const edit = document.createElement("button");
            edit.className = "edit-btn";
            edit.textContent = "Edit";
            edit.onclick = () => openEdit(p.id);

            const del = document.createElement("button");
            del.className = "delete-btn";
            del.textContent = "Delete";
            del.onclick = () => deleteProduct(p.id);

            actions.append(edit, del);
            info.appendChild(actions);
        }

        card.append(img, info);
        grid.appendChild(card);
    });
}

// ================= OWNER =================
function updateOwnerUI() {
    $("owner-panel").hidden = !isOwner;
    $("owner-btn").textContent = isOwner ? "Log out" : "Login";
    renderProducts();
}

$("owner-btn").onclick = () => {
    if (isOwner) {
        isOwner = false;
        try { sessionStorage.removeItem("shop_owner"); } catch (e) {}
        updateOwnerUI();
    } else {
        $("login-error").hidden = true;
        $("owner-password").value = "";
        $("login-modal").hidden = false;
        $("owner-password").focus();
    }
};

$("login-cancel").onclick = () => { $("login-modal").hidden = true; };

$("login-form").onsubmit = (e) => {
    e.preventDefault();
    if ($("owner-password").value === OWNER_PASSWORD) {
        isOwner = true;
        try { sessionStorage.setItem("shop_owner", "1"); } catch (err) {}
        $("login-modal").hidden = true;
        updateOwnerUI();
    } else {
        $("login-error").hidden = false;
    }
};

$("item-image").onchange = (e) => {
    const f = e.target.files[0];
    $("upload-label").textContent = f ? f.name : "Tap to choose a photo";
};

$("upload-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!isOwner) return; // only the owner can upload

    const file = $("item-image").files[0];
    if (!file) return;

    let image;
    try { image = await resizeImage(file); }
    catch (err) { alert("Could not read that image. Try another one."); return; }

    const product = {
        id: "p" + Date.now(),
        category: currentCategory,
        name: $("item-name").value.trim(),
        price: Number($("item-price").value),
        image
    };

    products.push(product);
    if (!store.set("shop_products", products)) {
        products.pop();
        alert("Storage is full. Delete some items and try again.");
        return;
    }

    e.target.reset();
    $("upload-label").textContent = "Tap to choose a photo";
    renderProducts();
};

function deleteProduct(id) {
    if (!isOwner) return;
    if (!confirm("Delete this item?")) return;
    products = products.filter((p) => p.id !== id);
    cart = cart.filter((c) => c.id !== id);
    store.set("shop_products", products);
    store.set("shop_cart", cart);
    renderProducts();
    renderCart();
}

// ================= CART =================
function addToCart(id) {
    const row = cart.find((c) => c.id === id);
    if (row) row.qty += 1; else cart.push({ id, qty: 1 });
    store.set("shop_cart", cart);
    renderCart();
}

function changeQty(id, delta) {
    const row = cart.find((c) => c.id === id);
    if (!row) return;
    row.qty += delta;
    if (row.qty <= 0) cart = cart.filter((c) => c.id !== id);
    store.set("shop_cart", cart);
    renderCart();
}

function renderCart() {
    const list = $("cart-items");
    list.innerHTML = "";
    let total = 0, count = 0;

    cart.forEach((c) => {
        const p = products.find((x) => x.id === c.id);
        if (!p) return;
        total += p.price * c.qty;
        count += c.qty;

        const row = document.createElement("div");
        row.className = "cart-row";

        const img = document.createElement("img");
        img.src = p.image;
        img.alt = p.name;

        const info = document.createElement("div");
        info.className = "cart-row-info";

        const name = document.createElement("div");
        name.textContent = p.name;

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = formatPrice(p.price);

        const qty = document.createElement("div");
        qty.className = "qty";
        const minus = document.createElement("button");
        minus.textContent = "−";
        minus.onclick = () => changeQty(c.id, -1);
        const num = document.createElement("span");
        num.textContent = c.qty;
        const plus = document.createElement("button");
        plus.textContent = "+";
        plus.onclick = () => changeQty(c.id, 1);
        qty.append(minus, num, plus);

        info.append(name, price, qty);
        row.append(img, info);
        list.appendChild(row);
    });

    if (count === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = "Your cart is empty.";
        list.appendChild(empty);
    }

    $("cart-total").textContent = formatPrice(total);
    $("cart-count").textContent = count;
}

function openCart() {
    $("cart-drawer").classList.add("open");
    $("overlay").classList.add("open");
}

function closeCart() {
    $("cart-drawer").classList.remove("open");
    $("overlay").classList.remove("open");
}

$("cart-btn").onclick = openCart;
$("cart-close").onclick = closeCart;
$("overlay").onclick = closeCart;

$("checkout-btn").onclick = () => {
    if (cart.length === 0) { alert("Your cart is empty."); return; }
    alert("Checkout is coming soon.");
};

// ================= EDIT ITEM (owner) =================
let editingId = null;
let editNewImage = null;

function openEdit(id) {
    if (!isOwner) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    editNewImage = null;
    $("edit-name").value = p.name;
    $("edit-price").value = p.price;
    $("edit-preview").src = p.image;
    $("edit-image").value = "";
    $("edit-image-label").textContent = "Tap to change photo";
    $("edit-modal").hidden = false;
}

$("edit-cancel").onclick = () => {
    $("edit-modal").hidden = true;
    editingId = null;
};

$("edit-image").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
        editNewImage = await resizeImage(f);
        $("edit-preview").src = editNewImage;
        $("edit-image-label").textContent = f.name;
    } catch (err) {
        alert("Could not read that image. Try another one.");
    }
};

$("edit-form").onsubmit = (e) => {
    e.preventDefault();
    if (!isOwner) return;
    const p = products.find((x) => x.id === editingId);
    if (!p) return;

    const backup = Object.assign({}, p);
    p.name = $("edit-name").value.trim();
    p.price = Number($("edit-price").value);
    if (editNewImage) p.image = editNewImage;
    p.sample = false; // an edited sample becomes a real item

    if (!store.set("shop_products", products)) {
        Object.assign(p, backup);
        alert("Storage is full. Try a smaller photo or delete some items.");
        return;
    }

    $("edit-modal").hidden = true;
    editingId = null;
    renderProducts();
    renderCart();
};

// ================= HOLD & DRAG TO REORDER (owner) =================
const HOLD_MS = 400;
let pending = null;   // a press waiting to turn into a drag
let drag = null;      // the drag in progress
let justDragged = false;

function cancelPending() {
    if (pending) { clearTimeout(pending.timer); pending = null; }
}

$("product-grid").addEventListener("pointerdown", (e) => {
    if (!isOwner || drag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const card = e.target.closest(".product-card");
    if (!card) return;
    cancelPending();
    pending = {
        card,
        startX: e.clientX, startY: e.clientY,
        x: e.clientX, y: e.clientY,
        timer: setTimeout(startDrag, HOLD_MS)
    };
});

function startDrag() {
    if (!pending) return;
    const { card, x, y } = pending;
    pending = null;
    const r = card.getBoundingClientRect();
    drag = { card, x, y, grabX: x - r.left, grabY: y - r.top, raf: 0 };
    card.classList.add("dragging");
    if (navigator.vibrate) navigator.vibrate(20);
    updateDrag();
    drag.raf = requestAnimationFrame(autoScroll);
}

function updateDrag() {
    if (!drag) return;
    const { card, x, y } = drag;

    // find the card under the finger and swap places with it
    const target = document.elementsFromPoint(x, y)
        .map((el) => el.closest && el.closest(".product-card"))
        .find((c) => c && c !== card);
    if (target && target.parentNode === card.parentNode) {
        if (card.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) {
            target.before(card);
        } else {
            target.after(card);
        }
    }

    // make the dragged card follow the finger
    card.style.transform = "none";
    const r = card.getBoundingClientRect();
    card.style.transform =
        "translate(" + (x - drag.grabX - r.left) + "px," + (y - drag.grabY - r.top) + "px) scale(1.04)";
}

function autoScroll() {
    if (!drag) return;
    const headerH = document.querySelector(".site-header").offsetHeight;
    let dy = 0;
    if (drag.y < headerH + 50) dy = -10;
    else if (drag.y > window.innerHeight - 120) dy = 10;
    if (dy) { window.scrollBy(0, dy); updateDrag(); }
    drag.raf = requestAnimationFrame(autoScroll);
}

function endDrag() {
    cancelPending();
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const card = drag.card;
    drag = null;
    card.classList.remove("dragging");
    card.style.transform = "";
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 350);
    saveOrder();
}

function saveOrder() {
    const ids = [...$("product-grid").querySelectorAll(".product-card")].map((c) => c.dataset.id);
    const ordered = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);
    const inCategory = products.filter((p) => p.category === currentCategory).length;
    if (ordered.length === inCategory) {
        let k = 0;
        products = products.map((p) => (p.category === currentCategory ? ordered[k++] : p));
        store.set("shop_products", products);
    }
    renderProducts();
}

document.addEventListener("pointermove", (e) => {
    if (pending) {
        if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > 10) {
            cancelPending(); // finger moved: it's a scroll, not a hold
        } else {
            pending.x = e.clientX;
            pending.y = e.clientY;
        }
    }
    if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
        updateDrag();
    }
});

document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

// stop the page from scrolling while an item is being dragged
document.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });

// no long-press menu on items, and ignore the tap that ends a drag
$("product-grid").addEventListener("contextmenu", (e) => { if (isOwner) e.preventDefault(); });
$("product-grid").addEventListener("click", (e) => {
    if (justDragged) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ================= SAMPLE ITEMS (for testing) =================
// Set to false when you no longer want sample items added.
const SEED_SAMPLES = true;

const CATEGORY_EMOJI = {
    tshirts: "👕", trousers: "👖", hoodies: "🧶",
    shoes: "👟", jackets: "🧥", caps: "🧢"
};

// [name, price, background color]
const SAMPLE_ITEMS = {
    tshirts: [
        ["Classic White Tee", 8500, "#eeeeee"],
        ["Black Graphic Tee", 10000, "#cfcfcf"],
        ["Oversized Sand Tee", 12000, "#e8dcc4"]
    ],
    trousers: [
        ["Slim Fit Chinos", 18000, "#d9cfb8"],
        ["Black Cargo Pants", 22000, "#c4c4c4"],
        ["Blue Denim Jeans", 20000, "#bcd0e6"]
    ],
    hoodies: [
        ["Grey Pullover Hoodie", 25000, "#d6d6d6"],
        ["Black Zip Hoodie", 28000, "#bdbdbd"],
        ["Cream Oversized Hoodie", 30000, "#f2e9d8"]
    ],
    shoes: [
        ["White Sneakers", 35000, "#f0f0f0"],
        ["Black Leather Boots", 45000, "#c9c9c9"],
        ["Running Trainers", 40000, "#d4e6d0"]
    ],
    jackets: [
        ["Denim Jacket", 32000, "#bcd0e6"],
        ["Black Bomber Jacket", 38000, "#c4c4c4"],
        ["Olive Windbreaker", 29000, "#d3dcc0"]
    ],
    caps: [
        ["Black Snapback", 6500, "#cfcfcf"],
        ["White Dad Cap", 6000, "#eeeeee"],
        ["Navy Baseball Cap", 7000, "#c5cfe6"]
    ]
};

// H3XA wordmark (same letter shapes as logo.svg), printed under the emoji
const WORDMARK_PATHS =
    '<g fill="none" stroke="#000" stroke-width="11" stroke-linejoin="bevel" ' +
    'transform="translate(143 296) scale(0.5) translate(-115 -22)">' +
    '<path d="M115.5 22V78M150.5 22V78M115.5 50H150.5"/>' +
    '<path d="M179 27.5H214.5V72.5H179M193 50H214.5" stroke-linejoin="miter"/>' +
    '<path d="M243 22L279 78M279 22L243 78"/>' +
    '<path d="M307 78L325 22L343 78M312 62H338"/>' +
    '</g>';

function makePlaceholder(emoji, color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
        '<rect width="400" height="400" fill="' + color + '"/>' +
        '<text x="200" y="230" font-size="160" text-anchor="middle">' + emoji + '</text>' +
        WORDMARK_PATHS + '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Re-draw sample images on every load so design updates show up
function refreshSampleImages() {
    products.forEach((p) => {
        if (!p.sample) return;
        const m = /^sample-([a-z]+)-(\d+)$/.exec(p.id);
        if (!m || !SAMPLE_ITEMS[m[1]]) return;
        const s = SAMPLE_ITEMS[m[1]][Number(m[2])];
        if (s) p.image = makePlaceholder(CATEGORY_EMOJI[m[1]], s[2]);
    });
}

function seedSamples() {
    if (!SEED_SAMPLES || store.get("shop_seeded", false)) return;
    Object.entries(SAMPLE_ITEMS).forEach(([category, items]) => {
        items.forEach(([name, price, color], i) => {
            products.push({
                id: "sample-" + category + "-" + i,
                category,
                name,
                price,
                image: makePlaceholder(CATEGORY_EMOJI[category], color),
                sample: true
            });
        });
    });
    store.set("shop_products", products);
    store.set("shop_seeded", true);
}

// Owner-only button to remove all sample items
(function addRemoveSamplesButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn";
    btn.style.marginTop = "12px";
    btn.textContent = "Remove sample items";
    btn.onclick = () => {
        if (!isOwner) return;
        if (!confirm("Remove all sample items?")) return;
        const ids = products.filter((p) => p.sample).map((p) => p.id);
        products = products.filter((p) => !p.sample);
        cart = cart.filter((c) => !ids.includes(c.id));
        store.set("shop_products", products);
        store.set("shop_cart", cart);
        renderProducts();
        renderCart();
    };
    $("owner-panel").appendChild(btn);
})();

// ================= INIT =================
seedSamples();
refreshSampleImages();
renderNav();
updateOwnerUI();
renderCart();
