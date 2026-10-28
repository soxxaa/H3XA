// ================= CONFIG =================
const SUPABASE_URL = "https://vfjzqbnwwdxdxdgumzhi.supabase.co";
const SUPABASE_KEY = "sb_publishable__06UmNiEgfYnv6hScSpC4g_wu3dbjkZ"; // publishable key: safe to be public
const BUCKET = "product-images";
const CURRENCY = "₦";
const CATEGORIES = {
    tshirts: "T-Shirts",
    trousers: "Trousers",
    hoodies: "Hoodies",
    shoes: "Shoes",
    jackets: "Jackets",
    caps: "Caps"
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ================= STATE =================
// The cart stays on each customer's own device. Products live in Supabase.
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

let products = [];                       // rows from the products table
let cart = store.get("shop_cart", []);   // {id, qty}
let currentCategory = "tshirts";
let isOwner = false;
let loadError = false;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);
const formatPrice = (n) => CURRENCY + Number(n).toLocaleString();
const byPosition = (a, b) =>
    (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at));

// Shrink a photo before uploading (keeps the site fast)
function resizeImage(file, maxSize = 1000) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
        img.onload = () => {
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image."))),
                "image/jpeg",
                0.85
            );
        };
        img.src = url;
    });
}

async function uploadImage(blob) {
    const path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000"
    });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function removeImage(url) {
    const marker = "/" + BUCKET + "/";
    const i = url ? url.indexOf(marker) : -1;
    if (i === -1) return;
    sb.storage.from(BUCKET).remove([url.slice(i + marker.length)]);
}

// ================= LOAD PRODUCTS =================
async function loadProducts() {
    const { data, error } = await sb
        .from("products")
        .select("*")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

    if (error) {
        loadError = true;
        renderProducts();
        return;
    }
    loadError = false;
    products = data || [];
    cart = cart.filter((c) => products.some((p) => p.id === c.id));
    store.set("shop_cart", cart);
    renderProducts();
    renderCart();
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
    const items = products.filter((p) => p.category === currentCategory).sort(byPosition);

    $("empty-msg").textContent = loadError
        ? "Could not load products. Check your connection and refresh."
        : "No items in this category yet.";
    $("empty-msg").hidden = items.length > 0;

    items.forEach((p) => {
        const card = document.createElement("div");
        card.className = "product-card" + (isOwner ? " owner-card" : "");
        card.dataset.id = p.id;

        const img = document.createElement("img");
        img.src = p.image_url;
        img.alt = p.name;
        img.draggable = false;
        img.loading = "lazy";

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

// ================= OWNER LOGIN =================
function updateOwnerUI() {
    $("owner-panel").hidden = !isOwner;
    $("owner-btn").textContent = isOwner ? "Log out" : "Login";
    renderProducts();
}

$("owner-btn").onclick = async () => {
    if (isOwner) {
        await sb.auth.signOut();
        isOwner = false;
        updateOwnerUI();
    } else {
        $("login-error").hidden = true;
        $("owner-password").value = "";
        $("login-modal").hidden = false;
        $("owner-email").focus();
    }
};

$("login-cancel").onclick = () => { $("login-modal").hidden = true; };

$("login-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
        email: $("owner-email").value.trim(),
        password: $("owner-password").value
    });
    btn.disabled = false;
    if (error) {
        $("login-error").hidden = false;
        return;
    }
    isOwner = true;
    $("login-modal").hidden = true;
    updateOwnerUI();
};

sb.auth.onAuthStateChange((_event, session) => {
    const now = !!session;
    if (now !== isOwner) { isOwner = now; updateOwnerUI(); }
});

// ================= ADD ITEM (owner) =================
$("item-image").onchange = (e) => {
    const f = e.target.files[0];
    $("upload-label").textContent = f ? f.name : "Tap to choose a photo";
};

$("upload-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!isOwner) return;
    const form = e.target;
    const file = $("item-image").files[0];
    if (!file) return;

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Uploading…";

    try {
        const blob = await resizeImage(file);
        const imageUrl = await uploadImage(blob);

        const inCat = products.filter((p) => p.category === currentCategory);
        const position = inCat.length ? Math.max(...inCat.map((p) => p.position)) + 1 : 0;

        const { data, error } = await sb.from("products").insert({
            category: currentCategory,
            name: $("item-name").value.trim(),
            price: Number($("item-price").value),
            image_url: imageUrl,
            position
        }).select().single();

        if (error) { removeImage(imageUrl); throw error; }

        products.push(data);
        form.reset();
        $("upload-label").textContent = "Tap to choose a photo";
        renderProducts();
    } catch (err) {
        alert("Upload failed: " + (err.message || "please try again."));
    } finally {
        btn.disabled = false;
        btn.textContent = "Upload item";
    }
};

// ================= DELETE ITEM (owner) =================
async function deleteProduct(id) {
    if (!isOwner) return;
    if (!confirm("Delete this item?")) return;
    const p = products.find((x) => x.id === id);

    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) { alert("Could not delete: " + error.message); return; }

    if (p) removeImage(p.image_url);
    products = products.filter((x) => x.id !== id);
    cart = cart.filter((c) => c.id !== id);
    store.set("shop_cart", cart);
    renderProducts();
    renderCart();
}

// ================= EDIT ITEM (owner) =================
let editingId = null;
let editNewImage = null; // Blob of a newly chosen photo

function openEdit(id) {
    if (!isOwner) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    editNewImage = null;
    $("edit-name").value = p.name;
    $("edit-price").value = p.price;
    $("edit-preview").src = p.image_url;
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
        $("edit-preview").src = URL.createObjectURL(editNewImage);
        $("edit-image-label").textContent = f.name;
    } catch (err) {
        alert("Could not read that image. Try another one.");
    }
};

$("edit-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!isOwner) return;
    const p = products.find((x) => x.id === editingId);
    if (!p) return;

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;

    try {
        const changes = {
            name: $("edit-name").value.trim(),
            price: Number($("edit-price").value)
        };
        const oldUrl = p.image_url;
        if (editNewImage) changes.image_url = await uploadImage(editNewImage);

        const { data, error } = await sb.from("products")
            .update(changes).eq("id", p.id).select().single();
        if (error) {
            if (changes.image_url) removeImage(changes.image_url);
            throw error;
        }

        Object.assign(p, data);
        if (editNewImage) removeImage(oldUrl);

        $("edit-modal").hidden = true;
        editingId = null;
        renderProducts();
        renderCart();
    } catch (err) {
        alert("Could not save: " + (err.message || "please try again."));
    } finally {
        btn.disabled = false;
    }
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

async function saveOrder() {
    const ids = [...$("product-grid").querySelectorAll(".product-card")].map((c) => c.dataset.id);
    const ordered = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);
    const inCategory = products.filter((p) => p.category === currentCategory).length;
    if (ordered.length !== inCategory) { renderProducts(); return; }

    const changed = [];
    ordered.forEach((p, i) => {
        if (p.position !== i) { p.position = i; changed.push(p); }
    });
    renderProducts();
    if (changed.length === 0) return;

    const results = await Promise.all(
        changed.map((p) => sb.from("products").update({ position: p.position }).eq("id", p.id))
    );
    if (results.some((r) => r.error)) {
        alert("Could not save the new order. Reloading.");
        loadProducts();
    }
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
        total += Number(p.price) * c.qty;
        count += c.qty;

        const row = document.createElement("div");
        row.className = "cart-row";

        const img = document.createElement("img");
        img.src = p.image_url;
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

// ================= INIT =================
(async function init() {
    renderNav();
    $("empty-msg").textContent = "Loading…";
    $("empty-msg").hidden = false;

    const sessionCheck = sb.auth.getSession()
        .then(({ data }) => { isOwner = !!(data && data.session); })
        .catch(() => {});

    await Promise.all([loadProducts(), sessionCheck]);
    updateOwnerUI();
    renderCart();
})();
