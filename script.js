// ================= CONFIG =================
const SUPABASE_URL = "https://vfjzqbnwwdxdxdgumzhi.supabase.co";
const SUPABASE_KEY = "sb_publishable__06UmNiEgfYnv6hScSpC4g_wu3dbjkZ"; // publishable key: safe to be public
const BUCKET = "product-images";
const CURRENCY = "₦";
const SHOP_NAME = "H3XA";

// Paystack PUBLIC key (pk_test_... while testing). Leave as is to take orders without online payment for now.
// Never put your secret key (sk_...) in this file.
const PAYSTACK_PUBLIC_KEY = "pk_test_PASTE_YOUR_PUBLIC_KEY_HERE";

// Order emails (EmailJS). Fill all four to turn on receipts + new-order alerts.
const OWNER_EMAIL = "PASTE_YOUR_EMAIL_HERE";          // new orders are emailed here
const EMAILJS_SERVICE_ID = "PASTE_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "PASTE_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY = "PASTE_PUBLIC_KEY";

// Used until the categories table exists in Supabase
const DEFAULT_CATEGORIES = [
    { id: "tshirts", name: "T-Shirts" },
    { id: "trousers", name: "Trousers" },
    { id: "hoodies", name: "Hoodies" },
    { id: "shoes", name: "Shoes" },
    { id: "jackets", name: "Jackets" },
    { id: "caps", name: "Caps" }
];

const STATUS_LABELS = {
    pending: "Pending payment",
    payment_reported: "Payment reported",
    paid: "Paid",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ================= STATE =================
// The cart stays on each customer's own device. Everything else lives in Supabase.
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

let categories = DEFAULT_CATEGORIES.map((c, i) => Object.assign({ position: i }, c));
let products = [];
let orders = [];
let ordersError = "";
let cart = store.get("shop_cart", []);   // {id, size, qty}
let currentCategory = "tshirts";
let isOwner = false;
let loadError = false;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);
const formatPrice = (n) => CURRENCY + Number(n).toLocaleString();
const byPosition = (a, b) =>
    (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at));
const catName = (id) => { const c = categories.find((x) => x.id === id); return c ? c.name : ""; };
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sizesOf = (p) => (Array.isArray(p.sizes) ? p.sizes : []);
const shortId = (id) => String(id).slice(0, 8).toUpperCase();

function parseSizes(text) {
    const out = [];
    text.split(",").forEach((s) => {
        const v = s.trim().toUpperCase();
        if (v && !out.includes(v)) out.push(v);
    });
    return out.slice(0, 12);
}

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

// ================= LOAD DATA =================
async function loadCategories() {
    const { data, error } = await sb.from("categories").select("*").order("position", { ascending: true });
    if (!error && data) categories = data;
    if (!categories.some((c) => c.id === currentCategory)) {
        currentCategory = categories.length ? categories[0].id : "";
    }
}

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
    categories.forEach((cat) => {
        const btn = document.createElement("button");
        btn.className = "menu-item" + (cat.id === currentCategory ? " active" : "");
        btn.textContent = cat.name;
        btn.onclick = () => { currentCategory = cat.id; renderNav(); renderProducts(); };
        nav.appendChild(btn);
    });
    const active = nav.querySelector(".active");
    if (active && active.scrollIntoView) active.scrollIntoView({ inline: "center", block: "nearest" });
}

function fillCategorySelects() {
    ["item-category", "edit-category"].forEach((id) => {
        const sel = $(id);
        const cur = sel.value;
        sel.innerHTML = "";
        categories.forEach((c) => {
            const o = document.createElement("option");
            o.value = c.id;
            o.textContent = c.name;
            sel.appendChild(o);
        });
        if (categories.some((c) => c.id === cur)) sel.value = cur;
    });
}

// ================= PRODUCT GRID =================
function renderProducts() {
    $("category-title").textContent = catName(currentCategory);
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
        card.onclick = (e) => {
            if (e.target.closest("button")) return;
            openProduct(p.id);
        };

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
        const sizes = sizesOf(p);
        add.textContent = "Add to cart";
        add.onclick = () => {
            if (sizes.length > 1) { openProduct(p.id); return; }
            addToCart(p.id, sizes[0] || "");
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

// ================= PRODUCT DETAILS (customers) =================
let pmProduct = null;
let pmSize = "";

function openProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    pmProduct = p;
    const sizes = sizesOf(p);
    pmSize = sizes.length === 1 ? sizes[0] : "";

    $("pm-img").src = p.image_url;
    $("pm-img").alt = p.name;
    $("pm-name").textContent = p.name;
    $("pm-price").textContent = formatPrice(p.price);
    $("pm-desc").textContent = p.description || "";
    $("pm-desc").hidden = !p.description;

    const chips = $("pm-sizes");
    chips.innerHTML = "";
    sizes.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "size-chip";
        b.textContent = s;
        b.onclick = () => {
            pmSize = s;
            $("pm-error").hidden = true;
            chips.querySelectorAll(".size-chip").forEach((x) => x.classList.toggle("selected", x === b));
        };
        chips.appendChild(b);
    });
    $("pm-sizes-wrap").hidden = sizes.length < 2;
    $("pm-error").hidden = true;
    $("pm-add").textContent = "Add to cart";
    $("pm-add").disabled = false;
    $("product-modal").hidden = false;
}

function closeProduct() {
    $("product-modal").hidden = true;
    pmProduct = null;
}

$("pm-close").onclick = closeProduct;
$("product-modal").onclick = (e) => { if (e.target === $("product-modal")) closeProduct(); };

$("pm-add").onclick = () => {
    if (!pmProduct) return;
    const sizes = sizesOf(pmProduct);
    if (sizes.length > 1 && !pmSize) { $("pm-error").hidden = false; return; }
    addToCart(pmProduct.id, pmSize || sizes[0] || "");
    $("pm-add").textContent = "Added ✓";
    $("pm-add").disabled = true;
    setTimeout(closeProduct, 600);
};

// ================= OWNER LOGIN =================
function updateOwnerUI() {
    $("fab").hidden = !isOwner;
    $("owner-btn").textContent = isOwner ? "Log out" : "Login";
    if (!isOwner) closeSheet();
    renderProducts();
    if (isOwner) loadOrders();
}

$("owner-btn").onclick = async () => {
    if (isOwner) {
        await sb.auth.signOut();
        isOwner = false;
        orders = [];
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

// ================= OWNER TOOLS (floating button + sheet) =================
const SHEET_VIEWS = {
    menu: ["sheet-menu", "Owner tools"],
    additem: ["upload-form", "Add item"],
    addcat: ["category-form", "Add category"],
    orders: ["orders-view", "Orders"],
    cats: ["categories-view", "Categories"]
};

function showView(name) {
    Object.entries(SHEET_VIEWS).forEach(([key, [elId]]) => { $(elId).hidden = key !== name; });
    $("sheet-title").textContent = SHEET_VIEWS[name][1];
    $("sheet-back").hidden = name === "menu";
    if (name === "additem") {
        fillCategorySelects();
        if (currentCategory) $("item-category").value = currentCategory;
    }
    if (name === "orders") loadOrders();
    if (name === "cats") renderCategoryList();
    $("sheet").querySelector(".sheet-body").scrollTop = 0;
}

function openSheet(view) {
    if (!isOwner) return;
    const sheetEl = $("sheet");
    sheetEl.style.height = "";
    sheetEl.style.maxHeight = "";
    sheetEl.dataset.state = "default";
    showView(view || "menu");
    $("sheet").classList.add("open");
    $("sheet-overlay").classList.add("open");
    $("fab").classList.add("open");
}

function closeSheet() {
    $("sheet").classList.remove("open");
    $("sheet-overlay").classList.remove("open");
    $("fab").classList.remove("open");
}

// ---------- drag the sheet up to full screen / down to close ----------
function naturalSheetHeight() {
    const sheet = $("sheet");
    const h0 = sheet.style.height, m0 = sheet.style.maxHeight, t0 = sheet.style.transition;
    sheet.style.transition = "none";
    sheet.style.height = "";
    sheet.style.maxHeight = "";
    const nat = sheet.offsetHeight;
    sheet.style.height = h0;
    sheet.style.maxHeight = m0;
    sheet.style.transition = t0;
    return nat;
}

function setSheetState(state) {
    const sheet = $("sheet");
    if (state === "full") {
        sheet.style.maxHeight = "none";
        sheet.style.height = (window.innerHeight - 10) + "px";
        sheet.dataset.state = "full";
    } else {
        const nat = naturalSheetHeight();
        sheet.style.maxHeight = "none";
        sheet.style.height = nat + "px";
        sheet.dataset.state = "default";
        setTimeout(() => {
            if (sheet.dataset.state === "default") {
                sheet.style.height = "";
                sheet.style.maxHeight = "";
            }
        }, 260);
    }
}

(function sheetDrag() {
    const sheet = $("sheet");
    let st = null;

    function begin(e) {
        if (e.target.closest("button") || !sheet.classList.contains("open")) return;
        st = {
            id: e.pointerId,
            startY: e.clientY,
            startH: sheet.offsetHeight,
            nat: naturalSheetHeight(),
            moved: false
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        sheet.style.transition = "none";
        sheet.style.maxHeight = "none";
    }

    function move(e) {
        if (!st || e.pointerId !== st.id) return;
        const dy = st.startY - e.clientY;
        if (Math.abs(dy) > 6) st.moved = true;
        const h = Math.max(120, Math.min(window.innerHeight - 10, st.startH + dy));
        sheet.style.height = h + "px";
    }

    function end(e) {
        if (!st || e.pointerId !== st.id) return;
        const s = st;
        st = null;
        sheet.style.transition = "";
        const h = sheet.offsetHeight;
        const fullH = window.innerHeight - 10;
        if (!s.moved) {                       // a tap on the handle toggles full / normal
            setSheetState(s.startH > s.nat + 20 ? "default" : "full");
            return;
        }
        if (h < s.nat * 0.6) { closeSheet(); return; }
        setSheetState(h > (s.nat + fullH) / 2 ? "full" : "default");
    }

    [document.querySelector(".sheet-handle"), document.querySelector(".sheet-head")].forEach((el) => {
        el.addEventListener("pointerdown", begin);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
    });
})();

$("fab").onclick = () => {
    if ($("sheet").classList.contains("open")) closeSheet(); else openSheet("menu");
};
$("sheet-close").onclick = closeSheet;
$("sheet-overlay").onclick = closeSheet;
$("sheet-back").onclick = () => showView("menu");
$("tool-additem").onclick = () => showView("additem");
$("tool-addcat").onclick = () => { $("cat-name").value = ""; showView("addcat"); };
$("tool-orders").onclick = () => showView("orders");
$("tool-cats").onclick = () => showView("cats");

// size quick-fill buttons (Add item + Edit item)
document.querySelectorAll(".preset-chips").forEach((box) => {
    box.querySelectorAll("button").forEach((b) => {
        b.onclick = () => { $(box.dataset.target).value = b.dataset.sizes.split(",").join(", ").trim(); };
    });
});

// ---------- add category ----------
$("category-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!isOwner) return;
    const name = $("cat-name").value.trim();
    if (!name) return;

    let id = slugify(name) || "category";
    const base = id;
    let n = 2;
    while (categories.some((c) => c.id === id)) id = base + "-" + (n++);
    const position = categories.length ? Math.max(...categories.map((c) => c.position || 0)) + 1 : 0;

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.from("categories").insert({ id, name, position }).select().single();
    btn.disabled = false;
    if (error) {
        alert("Could not add category: " + error.message + "\n(Have you run the new SQL in Supabase?)");
        return;
    }

    categories.push(data);
    currentCategory = data.id;
    fillCategorySelects();
    renderNav();
    renderProducts();
    closeSheet();
};

// ---------- manage categories ----------
function renderCategoryList() {
    const list = $("categories-list");
    list.innerHTML = "";
    if (!categories.length) {
        const p = document.createElement("p");
        p.className = "empty-msg";
        p.textContent = "No categories yet.";
        list.appendChild(p);
        return;
    }
    categories.forEach((c) => {
        const count = products.filter((p) => p.category === c.id).length;
        const row = document.createElement("div");
        row.className = "cat-row";

        const label = document.createElement("div");
        label.textContent = c.name + " (" + count + ")";

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = count ? "Has items" : "Delete";
        del.disabled = count > 0;
        del.onclick = () => deleteCategory(c.id);

        row.append(label, del);
        list.appendChild(row);
    });
}

async function deleteCategory(id) {
    if (!isOwner) return;
    if (products.some((p) => p.category === id)) return;
    if (!confirm("Delete this category?")) return;
    const { error } = await sb.from("categories").delete().eq("id", id);
    if (error) { alert("Could not delete: " + error.message); return; }
    categories = categories.filter((c) => c.id !== id);
    if (currentCategory === id) currentCategory = categories.length ? categories[0].id : "";
    fillCategorySelects();
    renderNav();
    renderProducts();
    renderCategoryList();
}

// ---------- orders ----------
function updateOrderBadges() {
    const open = orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled").length;
    [$("fab-badge"), $("orders-count")].forEach((b) => {
        b.textContent = open;
        b.hidden = open === 0;
    });
}

async function loadOrders() {
    if (!isOwner) return;
    const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) {
        ordersError = error.message;
    } else {
        ordersError = "";
        orders = data || [];
    }
    renderOrders();
    updateOrderBadges();
}

function renderOrders() {
    const list = $("orders-list");
    list.innerHTML = "";

    if (ordersError) {
        const p = document.createElement("p");
        p.className = "empty-msg";
        p.textContent = "Could not load orders. Have you run the new SQL in Supabase?";
        list.appendChild(p);
        return;
    }
    if (!orders.length) {
        const p = document.createElement("p");
        p.className = "empty-msg";
        p.textContent = "No orders yet.";
        list.appendChild(p);
        return;
    }

    orders.forEach((o) => {
        const card = document.createElement("div");
        card.className = "order-card";

        const top = document.createElement("div");
        top.className = "order-top";
        const head = document.createElement("div");
        const idEl = document.createElement("div");
        idEl.className = "order-id";
        idEl.textContent = "#" + shortId(o.id);
        const dateEl = document.createElement("div");
        dateEl.className = "order-date";
        dateEl.textContent = new Date(o.created_at).toLocaleString();
        head.append(idEl, dateEl);

        const sel = document.createElement("select");
        Object.entries(STATUS_LABELS).forEach(([val, label]) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            sel.appendChild(opt);
        });
        sel.value = o.status;
        sel.onchange = async () => {
            const { error } = await sb.from("orders").update({ status: sel.value }).eq("id", o.id);
            if (error) { alert("Could not update: " + error.message); sel.value = o.status; return; }
            o.status = sel.value;
            updateOrderBadges();
        };
        top.append(head, sel);

        const who = document.createElement("div");
        const nameEl = document.createElement("strong");
        nameEl.textContent = o.customer_name;
        const phone = document.createElement("a");
        phone.href = "tel:" + o.customer_phone;
        phone.textContent = o.customer_phone;
        const mail = document.createElement("a");
        mail.href = "mailto:" + o.customer_email;
        mail.textContent = o.customer_email;
        who.append(nameEl, document.createElement("br"), phone, document.createElement("br"), mail);

        const addr = document.createElement("div");
        addr.className = "order-address";
        addr.textContent = o.address;

        const itemsBox = document.createElement("div");
        itemsBox.className = "order-items";
        (o.items || []).forEach((it) => {
            const line = document.createElement("div");
            line.textContent = it.name + (it.size ? " (Size " + it.size + ")" : "") +
                " × " + it.qty + " — " + formatPrice(it.price * it.qty);
            itemsBox.appendChild(line);
        });

        const total = document.createElement("div");
        total.className = "order-total";
        total.textContent = "Total: " + formatPrice(o.total);

        card.append(top, who, addr, itemsBox, total);
        list.appendChild(card);
    });
}

$("orders-refresh").onclick = loadOrders;

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
    const category = $("item-category").value;
    if (!file) return;
    if (!category) { alert("Add a category first."); return; }

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Uploading…";
    let ok = false;

    try {
        const blob = await resizeImage(file);
        const imageUrl = await uploadImage(blob);

        const inCat = products.filter((p) => p.category === category);
        const position = inCat.length ? Math.max(...inCat.map((p) => p.position)) + 1 : 0;

        const { data, error } = await sb.from("products").insert({
            category,
            name: $("item-name").value.trim(),
            price: Number($("item-price").value),
            description: $("item-desc").value.trim(),
            sizes: parseSizes($("item-sizes").value),
            image_url: imageUrl,
            position
        }).select().single();

        if (error) { removeImage(imageUrl); throw error; }

        products.push(data);
        form.reset();
        $("upload-label").textContent = "Tap to choose a photo";
        $("item-category").value = category;
        currentCategory = category;
        renderNav();
        renderProducts();
        ok = true;
    } catch (err) {
        alert("Upload failed: " + (err.message || "please try again.") +
            "\n(If it mentions a missing column, run the new SQL in Supabase first.)");
    }

    btn.disabled = false;
    btn.textContent = ok ? "Added ✓" : "Upload item";
    if (ok) setTimeout(() => { btn.textContent = "Upload item"; }, 1400);
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
    fillCategorySelects();
    $("edit-category").value = p.category;
    $("edit-name").value = p.name;
    $("edit-price").value = p.price;
    $("edit-desc").value = p.description || "";
    $("edit-sizes").value = sizesOf(p).join(", ");
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
        const newCategory = $("edit-category").value;
        const changes = {
            name: $("edit-name").value.trim(),
            price: Number($("edit-price").value),
            description: $("edit-desc").value.trim(),
            sizes: parseSizes($("edit-sizes").value),
            category: newCategory
        };
        if (newCategory !== p.category) {
            const inNew = products.filter((x) => x.category === newCategory);
            changes.position = inNew.length ? Math.max(...inNew.map((x) => x.position)) + 1 : 0;
        }
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
const sameLine = (c, id, size) => c.id === id && (c.size || "") === (size || "");

function addToCart(id, size) {
    const row = cart.find((c) => sameLine(c, id, size));
    if (row) row.qty += 1; else cart.push({ id, size: size || "", qty: 1 });
    store.set("shop_cart", cart);
    renderCart();
}

function changeQty(id, size, delta) {
    const row = cart.find((c) => sameLine(c, id, size));
    if (!row) return;
    row.qty += delta;
    if (row.qty <= 0) cart = cart.filter((c) => c !== row);
    store.set("shop_cart", cart);
    renderCart();
}

function cartTotal() {
    return cart.reduce((sum, c) => {
        const p = products.find((x) => x.id === c.id);
        return p ? sum + Number(p.price) * c.qty : sum;
    }, 0);
}

function renderCart() {
    const list = $("cart-items");
    list.innerHTML = "";
    let count = 0;

    cart.forEach((c) => {
        const p = products.find((x) => x.id === c.id);
        if (!p) return;
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

        const meta = document.createElement("div");
        meta.className = "product-price";
        meta.textContent = formatPrice(p.price) + (c.size ? " · Size " + c.size : "");

        const qty = document.createElement("div");
        qty.className = "qty";
        const minus = document.createElement("button");
        minus.textContent = "−";
        minus.onclick = () => changeQty(c.id, c.size, -1);
        const num = document.createElement("span");
        num.textContent = c.qty;
        const plus = document.createElement("button");
        plus.textContent = "+";
        plus.onclick = () => changeQty(c.id, c.size, 1);
        qty.append(minus, num, plus);

        info.append(name, meta, qty);
        row.append(img, info);
        list.appendChild(row);
    });

    if (count === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = "Your cart is empty.";
        list.appendChild(empty);
    }

    $("cart-total").textContent = formatPrice(cartTotal());
    $("cart-count").textContent = count;
}

function openCart() {
    $("cart-drawer").classList.add("open");
    $("overlay").classList.add("open");
    document.body.classList.add("cart-open");
}

function closeCart() {
    $("cart-drawer").classList.remove("open");
    $("overlay").classList.remove("open");
    document.body.classList.remove("cart-open");
}

$("cart-btn").onclick = openCart;
$("cart-close").onclick = closeCart;
$("overlay").onclick = closeCart;

// ================= ORDER EMAILS (EmailJS) =================
function emailsReady() {
    return ![OWNER_EMAIL, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY]
        .some((v) => v.indexOf("PASTE") !== -1);
}

async function sendEmail(params) {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            template_params: params
        })
    });
    if (!res.ok) throw new Error(await res.text());
}

async function sendOrderEmails(order, details, lines, paid) {
    if (!emailsReady()) return false;
    const orderLines = lines.map((l) =>
        "• " + l.name + (l.size ? " (Size " + l.size + ")" : "") + " × " + l.qty + " — " + formatPrice(l.price * l.qty)
    ).join("\n");
    const common = {
        shop_name: SHOP_NAME,
        order_id: shortId(order.order_id),
        date: new Date().toLocaleString(),
        order_lines: orderLines,
        total: formatPrice(order.order_total),
        payment_status: paid
            ? "Paid online."
            : "Payment pending. We will contact you to arrange payment and delivery.",
        customer_name: details.name,
        customer_phone: details.phone,
        customer_email: details.email,
        address: details.address
    };
    const results = await Promise.allSettled([
        sendEmail(Object.assign({}, common, {
            to_email: details.email,
            subject: "Your " + SHOP_NAME + " order #" + common.order_id,
            heading: "Thank you for your order!",
            intro: "Hi " + details.name + ", here is your order receipt."
        })),
        sendEmail(Object.assign({}, common, {
            to_email: OWNER_EMAIL,
            subject: "New order #" + common.order_id + " — " + common.total,
            heading: "New order received",
            intro: "Deliver to the address below."
        }))
    ]);
    return results[0].status === "fulfilled";
}

// ================= CHECKOUT =================
function paystackOn() { return PAYSTACK_PUBLIC_KEY.indexOf("PASTE") === -1; }

function showCheckoutError(msg) {
    $("co-error").textContent = msg;
    $("co-error").hidden = false;
}

function resetPayButton() {
    $("co-pay").disabled = false;
    $("co-pay").textContent = (paystackOn() ? "Pay " : "Place order · ") + formatPrice(cartTotal());
}

$("checkout-btn").onclick = () => {
    if (cart.length === 0) { alert("Your cart is empty."); return; }
    closeCart();
    const saved = store.get("shop_customer", {});
    $("co-name").value = saved.name || "";
    $("co-email").value = saved.email || "";
    $("co-phone").value = saved.phone || "";
    $("co-address").value = saved.address || "";
    $("co-error").hidden = true;
    $("checkout-form").hidden = false;
    $("checkout-done").hidden = true;
    resetPayButton();
    $("checkout-modal").hidden = false;
};

$("co-cancel").onclick = () => { $("checkout-modal").hidden = true; };
$("co-close").onclick = () => { $("checkout-modal").hidden = true; };

async function finishOrder(order, details, lines, paid, reference) {
    if (paid) {
        try { await sb.rpc("report_payment", { p_order: order.order_id, p_reference: reference }); }
        catch (err) { /* the payment still went through */ }
    }
    let emailed = false;
    try { emailed = await sendOrderEmails(order, details, lines, paid); } catch (err) {}

    cart = [];
    store.set("shop_cart", cart);
    renderCart();

    let text = paid
        ? "Payment received. Your reference is " + reference + "."
        : "Order #" + shortId(order.order_id) + " received.";
    text += " We will contact you on " + details.phone + " to " +
        (paid ? "confirm delivery." : "arrange payment and delivery.");
    if (emailed) text += " A receipt was sent to " + details.email + ".";

    $("co-done-text").textContent = text;
    $("checkout-form").hidden = true;
    $("checkout-done").hidden = false;
}

$("checkout-form").onsubmit = async (e) => {
    e.preventDefault();
    $("co-error").hidden = true;

    if (paystackOn() && typeof PaystackPop === "undefined") {
        showCheckoutError("Payment could not load. Check your connection and try again.");
        return;
    }

    const details = {
        name: $("co-name").value.trim(),
        email: $("co-email").value.trim(),
        phone: $("co-phone").value.trim(),
        address: $("co-address").value.trim()
    };
    store.set("shop_customer", details);

    $("co-pay").disabled = true;
    $("co-pay").textContent = "Please wait…";

    // The server works out the real total from the product prices.
    const cartLines = cart.filter((c) => products.some((p) => p.id === c.id));
    const lines = cartLines.map((c) => {
        const p = products.find((x) => x.id === c.id);
        return { name: p.name, price: Number(p.price), size: c.size || "", qty: c.qty };
    });

    const { data, error } = await sb.rpc("create_order", {
        p_name: details.name,
        p_email: details.email,
        p_phone: details.phone,
        p_address: details.address,
        p_items: cartLines.map((c) => ({ id: c.id, qty: c.qty, size: c.size || "" }))
    });

    if (error || !data || !data.length) {
        showCheckoutError(error ? error.message : "Could not start your order. Please try again.");
        resetPayButton();
        return;
    }
    const order = data[0];

    if (!paystackOn()) {
        await finishOrder(order, details, lines, false, "");
        return;
    }

    const popup = new PaystackPop();
    popup.newTransaction({
        key: PAYSTACK_PUBLIC_KEY,
        email: details.email,
        amount: Math.round(Number(order.order_total) * 100), // kobo
        currency: "NGN",
        reference: "H3XA-" + order.order_id,
        metadata: {
            order_id: order.order_id,
            custom_fields: [
                { display_name: "Customer", variable_name: "customer", value: details.name },
                { display_name: "Phone", variable_name: "phone", value: details.phone }
            ]
        },
        onSuccess: (tx) => { finishOrder(order, details, lines, true, tx.reference); },
        onCancel: () => { resetPayButton(); }
    });
};

// ================= INIT =================
(async function init() {
    $("empty-msg").textContent = "Loading…";
    $("empty-msg").hidden = false;

    const sessionCheck = sb.auth.getSession()
        .then(({ data }) => { isOwner = !!(data && data.session); })
        .catch(() => {});

    await Promise.all([loadCategories(), loadProducts(), sessionCheck]);
    fillCategorySelects();
    renderNav();
    updateOwnerUI();
    renderCart();
})();
