/* ==========================================
   IMPORTS & KONFIGURATION
   ========================================== */
import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const API_URL = "/api"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let map = null;
let markers = []; 
let currentForumTopic = null; 
// Welche Haupt-Kategorien dürfen von Usern erweitert werden?
const USER_EDITABLE_CATEGORIES = ["bikes", "garage", "tours"];

/* ==========================================
   APP START
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 SPA startet...");

    initMap();

    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        if (user) {
            updateUI(); 
            await syncUserWithBackend(user); 
        } else {
            currentRole = "guest";
            if (getActivePage() === 'profile') {
                navigateTo('home');
            }
            updateUI();
        }
    });

    loadToursFromServer();
    loadForumData(); 
    setupEventListeners();
    
    const startPage = window.location.hash.replace('#', '') || 'home';
    navigateTo(startPage);
});

/* ==========================================
   ROUTER
   ========================================== */

function navigateTo(pageId) {
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`page-${pageId}`);
    if (target) {
        target.classList.add('active');
        const navLink = document.getElementById(`nav-${pageId}`);
        if(navLink) navLink.classList.add('active');
        window.location.hash = pageId;

        if (pageId === 'tours' && map) {
            setTimeout(() => { map.invalidateSize(); }, 100);
        }
    }
}

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}
window.navigateTo = navigateTo;

/* ==========================================
   AUTH & UI
   ========================================== */

async function syncUserWithBackend(firebaseUser) {
    try {
        const response = await fetch(`${API_URL}/user-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: firebaseUser.uid, email: firebaseUser.email })
        });
        if(response.ok) {
            const dbUser = await response.json();
            currentRole = dbUser.role || "user"; 
            updateUI(); 
        }
    } catch (err) { console.warn("Backend Sync skip"); }
}

function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const secureLinks = document.querySelectorAll('.auth-required');
    const addTourBtn = document.querySelector('#add-tour-btn');

    if (currentUser) {
        if(authBtn) authBtn.style.display = 'none'; 
        if(logoutBtn) logoutBtn.style.display = 'block';

        secureLinks.forEach(link => {
            link.classList.remove('d-none');
            link.style.display = ''; 
        });

        if(userInfo) {
            userInfo.style.display = 'block';
            const displayName = currentUser.displayName || currentUser.email.split('@')[0];
            let roleBadge = '<span class="badge bg-secondary">USER</span>';
            if(currentRole === 'admin') roleBadge = '<span class="badge bg-danger">ADMIN</span>';
            userInfo.innerHTML = `Hallo, <b>${displayName}</b> ${roleBadge}`;
        }
        if(addTourBtn) addTourBtn.style.display = 'block';
        fillProfilePageData();
    } else {
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        secureLinks.forEach(link => link.classList.add('d-none'));
        if(addTourBtn) addTourBtn.style.display = 'none';
        if (getActivePage() === 'profile') navigateTo('home');
    }
}

function fillProfilePageData() {
    const nameDisplay = document.getElementById('profile-display-name');
    const emailDisplay = document.getElementById('profile-email-display');
    if(currentUser) {
        if(nameDisplay) nameDisplay.innerText = currentUser.displayName || "Biker";
        if(emailDisplay) emailDisplay.innerText = currentUser.email;
    }
}

function showDeleteButtons() {
    const deleteBtns = document.querySelectorAll('.delete-btn');
    deleteBtns.forEach(btn => {
        btn.style.display = (currentRole === 'admin') ? 'block' : 'none';
    });
}

/* ==========================================
   BUTTONS & FORMS
   ========================================== */

function setupEventListeners() {
    // 1. LOGOUT
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            navigateTo('home');
        });
    }

    // 2. AUTH MODAL
    const switchBtn = document.getElementById('btn-switch-mode');
    const nameContainer = document.getElementById('authNameContainer');
    const submitBtn = document.getElementById('btn-submit-auth');
    const authForm = document.getElementById('authForm');
    const modalTitle = document.querySelector('.modal-title');

    if(switchBtn && nameContainer) {
        switchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isRegisterMode = nameContainer.style.display === 'block';
            if(isRegisterMode) {
                nameContainer.style.display = 'none';
                submitBtn.innerText = "Einloggen";
                switchBtn.innerText = "Hier registrieren";
                if(modalTitle) modalTitle.innerText = "Anmelden";
            } else {
                nameContainer.style.display = 'block';
                submitBtn.innerText = "Kostenlos Registrieren";
                switchBtn.innerText = "Zurück zum Login";
                if(modalTitle) modalTitle.innerText = "Neues Konto erstellen";
            }
        });
    }

    // 3. AUTH SUBMIT
    if(authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const isRegisterMode = nameContainer && nameContainer.style.display === 'block';
            if (isRegisterMode) handleRegister(); else handleLogin(e);
        });
    }

    // 4. TOUR HINZUFÜGEN
    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);

    // 5. NEUER FORUM BEITRAG
    const createThreadForm = document.getElementById('createThreadForm');
    if (createThreadForm) {
        createThreadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!currentUser) {
                alert("Bitte logge dich erst ein!");
                return;
            }

            const title = document.getElementById('threadTitle').value;
            const text = document.getElementById('threadText').value;
            const btn = e.target.querySelector('button[type="submit"]');

            btn.disabled = true;
            btn.innerText = "Sende...";

            try {
                const newPost = {
                    topic: currentForumTopic,
                    title: title,
                    text: text,
                    user: currentUser.displayName || "Unbekannt"
                };

                const response = await fetch(`${API_URL}/threads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newPost)
                });

                if (response.ok) {
                    const modalEl = document.getElementById('createThreadModal');
                    bootstrap.Modal.getInstance(modalEl).hide();
                    e.target.reset();
                    
                    await loadForumData(); 
                    renderForumThreads(currentForumTopic);
                } else {
                    throw new Error("Fehler beim Speichern");
                }
            } catch (err) {
                alert(err.message);
            } finally {
                btn.disabled = false;
                btn.innerText = "Veröffentlichen";
            }
        });
    }
}

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

async function handleRegister() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nickname = document.getElementById('authName').value; 
    const msg = document.getElementById('auth-message');

    if (!nickname || nickname.trim() === "") {
        msg.innerHTML = `<span class="text-danger">Bitte wähle einen Nickname!</span>`;
        return;
    }
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: nickname });
        msg.innerHTML = `<span class="text-success">Willkommen <b>${nickname}</b>!</span>`;
        setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
        msg.innerHTML = `<span class="text-danger">${error.message}</span>`;
    }
}

async function handleLogin(e) {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('auth-message');
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        const modalEl = document.getElementById('authModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if(modal) modal.hide();
    } catch (error) {
        msg.innerHTML = `<span class="text-danger">Fehler: ${error.message}</span>`;
    }
}

async function handleAddTour(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const newTour = {
        title: document.getElementById('newTitle').value,
        category: document.getElementById('newRegion').value,
        country: document.getElementById('newCountry').value,
        state: document.getElementById('newState').value || "Community",
        km: document.getElementById('newKm').value,
        time: document.getElementById('newTime').value,
        desc: document.getElementById('newDesc').value,
        coords: [48 + Math.random(), 11 + Math.random()] 
    };

    try {
        const response = await fetch(`${API_URL}/tours`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newTour)
        });
        if(response.ok) {
            const savedTour = await response.json();
            toursData.unshift(savedTour);
            const modalEl = document.getElementById('addTourModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            e.target.reset();
            filterTours();
            alert("Gespeichert!");
        } else { throw new Error("Server Fehler"); }
    } catch (err) {
        alert("Fehler beim Speichern: " + err.message);
    } finally {
        btn.disabled = false;
    }
}

/* ==========================================
   DATEN & FILTER (TOUREN)
   ========================================== */

async function loadToursFromServer() {
    try {
        const response = await fetch(`${API_URL}/tours`);
        if (response.ok) {
            toursData = await response.json();
        }
    } catch (error) {
        console.warn("API Offline, leere Liste.");
    } finally {
        initFilters();  
        filterTours();  
    }
}

function initMap() {
    if (map) return; 
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    map = L.map('map').setView([51.16, 10.45], 6); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

function initFilters() {
    const catSelect = document.getElementById('filter-category');
    if(!catSelect) return;
    catSelect.innerHTML = '<option value="all">Bitte wählen...</option>';
    if(toursData.length > 0) {
        const cats = [...new Set(toursData.map(t => t.category))].sort();
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.innerText = c;
            catSelect.appendChild(opt);
        });
    }
}

function onCategoryChange() {
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    const selectedCat = catSelect.value;
    const selectedCountry = countrySelect.value;

    countrySelect.innerHTML = '<option value="all">--</option>';
    stateSelect.innerHTML = '<option value="all">--</option>';
    countrySelect.disabled = true;
    stateSelect.disabled = true;

    if (selectedCat !== 'all') {
        const matchingTours = toursData.filter(t => t.category === selectedCat);
        const countries = [...new Set(matchingTours.map(t => t.country))].sort();
        countrySelect.innerHTML = '<option value="all">Alle Länder</option>';
        countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.innerText = c;
            countrySelect.appendChild(opt);
        });
        countrySelect.disabled = false;
    }
    filterTours(); 
}

function onCountryChange() {
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    const selectedCat = catSelect.value;
    const selectedCountry = countrySelect.value;

    stateSelect.innerHTML = '<option value="all">--</option>';
    stateSelect.disabled = true;

    if (selectedCountry !== 'all') {
        const matchingTours = toursData.filter(t => 
            (selectedCat === 'all' || t.category === selectedCat) && 
            t.country === selectedCountry
        );
        const states = [...new Set(matchingTours.map(t => t.state))].sort();
        stateSelect.innerHTML = '<option value="all">Alle Gebiete</option>';
        states.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.innerText = s;
            stateSelect.appendChild(opt);
        });
        stateSelect.disabled = false;
    }
    filterTours();
}

function filterTours() {
    const cat = document.getElementById('filter-category')?.value;
    const country = document.getElementById('filter-country')?.value;
    const state = document.getElementById('filter-state')?.value;
    const search = document.getElementById('search-input')?.value.toLowerCase();

    let filtered = toursData;

    if(cat && cat !== 'all') filtered = filtered.filter(t => t.category === cat);
    if(country && country !== 'all') filtered = filtered.filter(t => t.country === country);
    if(state && state !== 'all') filtered = filtered.filter(t => t.state === state);
    if(search && search.trim() !== '') {
        filtered = filtered.filter(t => 
            t.title.toLowerCase().includes(search) || 
            (t.desc && t.desc.toLowerCase().includes(search))
        );
    }
    renderTours(filtered);
}

function resetFilters() {
    document.getElementById('search-input').value = "";
    document.getElementById('filter-category').value = "all";
    onCategoryChange(); 
}

function renderTours(data) {
    const listContainer = document.getElementById('tours-container');
    if(!listContainer) return;
    listContainer.innerHTML = '';
    
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    if(data.length === 0) {
        if(toursData.length > 0) listContainer.innerHTML = '<div class="text-center text-muted p-3">Keine passenden Touren gefunden.</div>';
        return;
    }

    data.forEach(tour => {
        if(tour.coords) {
            const marker = L.marker(tour.coords).addTo(map);
            marker.bindPopup(`<b>${tour.title}</b>`);
            marker.on('click', () => selectTourCard(tour));
            markers.push(marker);
        }
        const card = document.createElement('div');
        card.className = 'mini-tour-card mb-2 p-3 border rounded shadow-sm bg-white';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <h5 class="fw-bold m-0">${tour.title}</h5>
                <button class="btn btn-sm btn-danger delete-btn" style="display:none;" onclick="deleteTour('${tour.id}', event)">🗑️</button>
            </div>
            <div class="small text-muted mb-2">
                ${tour.category} • ${tour.country} • ${tour.state}
            </div>
            <p class="small mb-0 text-secondary">${tour.desc || "Keine Beschreibung"}</p>
        `;
        card.addEventListener('click', () => selectTourCard(tour));
        listContainer.appendChild(card);
    });
    showDeleteButtons();
}

function selectTourCard(tour) {
    navigateTo('tours');
    const catSelect = document.getElementById('filter-category');
    if(tour.coords && map) map.flyTo(tour.coords, 10);
    if(tour.category) {
        catSelect.value = tour.category;
        onCategoryChange(); 
    }
}

/* ==========================================
   HELPER: EMOJIS EINFÜGEN
   ========================================== */
window.insertEmoji = function(emoji, targetId = 'threadText') {
    const textarea = document.getElementById(targetId);
    if (textarea) {
        textarea.value += emoji;
        textarea.focus();
    }
};

/* ==========================================
   FORUM LOGIK (Classic Forum Style)
   ========================================== */

let allForumData = []; 
let allThreadsCache = []; 
let currentCategoryId = null; 

async function loadForumData() {
    const container = document.getElementById('forum-container');
    if(!container) return;
    
    if(allForumData.length === 0) {
        container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';
    }
    
    try {
        const catResponse = await fetch(`${API_URL}/forum`);
        if (!catResponse.ok) throw new Error("Kategorie-Fehler");
        allForumData = await catResponse.json();

        const threadResponse = await fetch(`${API_URL}/threads`); 
        if (threadResponse.ok) {
            allThreadsCache = await threadResponse.json();
        }

        // Wenn keine Navigation aktiv ist, Startseite laden
        if (!document.querySelector('.custom-breadcrumb')) {
            renderForumHome();
        }
    } catch (error) {
        console.error(error);
        if(allForumData.length === 0) {
            container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden.</div>';
        }
    }
}

// HELPER: Breadcrumbs rendern
function renderBreadcrumbs(pathArray) {
    const container = document.getElementById('forum-title-area');
    // Wir nutzen den Bereich über dem Container für die Breadcrumbs
    // Falls er noch nicht existiert, erstellen wir ihn
    let breadcrumbEl = document.getElementById('custom-breadcrumbs');
    
    if (!breadcrumbEl) {
        const parent = document.getElementById('forum-container').parentNode;
        breadcrumbEl = document.createElement('div');
        breadcrumbEl.id = 'custom-breadcrumbs';
        breadcrumbEl.className = 'custom-breadcrumb container-xl';
        parent.insertBefore(breadcrumbEl, document.getElementById('forum-container'));
    }

    // HTML bauen
    let html = `<a onclick="navigateTo('home')">Startseite</a> <span>›</span> <a onclick="renderForumHome()">Forum</a>`;
    
    pathArray.forEach((item, index) => {
        html += ` <span>›</span> `;
        if (item.onclick) {
            html += `<a onclick="${item.onclick}">${item.label}</a>`;
        } else {
            html += `<span class="active">${item.label}</span>`;
        }
    });

    breadcrumbEl.innerHTML = html;
    breadcrumbEl.style.display = 'block';
}

// HELPER: Statistiken & Letzter Beitrag berechnen
function getForumStats(filterFn) {
    const threads = allThreadsCache.filter(filterFn);
    const threadCount = threads.length;
    // Beiträge = Anzahl Threads + Anzahl aller Antworten in diesen Threads
    const postCount = threads.reduce((acc, t) => acc + 1 + (t.replies || 0), 0);
    
    // Neuesten Beitrag finden
    threads.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt) : new Date(a.date);
        const timeB = b.createdAt ? new Date(b.createdAt) : new Date(b.date);
        return timeB - timeA;
    });

    const lastPost = threads.length > 0 ? threads[0] : null;

    return { threadCount, postCount, lastPost };
}

// LEVEL 1: Hauptübersicht (TABLE LAYOUT)
window.renderForumHome = function() {
    renderBreadcrumbs([]); // Leeres Array = Nur "Startseite > Forum"
    
    const container = document.getElementById('forum-container');
    
    // Wir verstecken die alten Header-Elemente, da wir eigene bauen
    const titleEl = document.getElementById('forum-title');
    if(titleEl) titleEl.style.display = 'none';
    const subEl = document.getElementById('forum-subtitle');
    if(subEl) subEl.style.display = 'none';
    const backBtn = document.getElementById('forum-back-btn');
    if(backBtn) backBtn.style.display = 'none';
    const newBtn = document.getElementById('new-thread-btn');
    if(newBtn) newBtn.style.display = 'none';

    container.innerHTML = `
        <h2 class="fw-bold mb-3">Community Übersicht</h2>
        <div class="d-none d-md-flex forum-header-row">
            <div style="flex-grow:1;">Forum</div>
            <div style="width:100px; text-align:center;">Themen</div>
            <div style="width:100px; text-align:center;">Beiträge</div>
            <div style="width:30px;"></div>
        </div>
    `;

    allForumData.forEach(cat => {
        // Stats berechnen (Alle Topics dieser Kategorie sammeln)
        const catTopicNames = cat.topics.map(t => t.title);
        const stats = getForumStats(t => catTopicNames.includes(t.topic));
        
        let lastPostHtml = `<small class="text-muted">Keine Beiträge</small>`;
        if (stats.lastPost) {
            // DAS IST DER BMW STYLE: Titel und User untereinander
            lastPostHtml = `
                <div class="mt-1 small text-muted">
                    Letzter: <span class="text-dark fw-bold">${stats.lastPost.user}</span> 
                    <span class="text-secondary">(${stats.lastPost.date})</span>
                </div>
            `;
        }

        // Icon Logik (Falls du keine echten Icons hast, nehmen wir generische)
        const icon = "🏍️"; // Oder ein <img> Tag

        container.innerHTML += `
            <div class="forum-row" style="cursor:pointer;" onclick="renderForumSubCategory('${cat.id}')">
                <div class="forum-icon">${icon}</div>
                <div class="forum-main">
                    <h5 class="fw-bold text-dark mb-0">${cat.title}</h5>
                    <p class="text-muted small mb-0">${cat.desc || ""}</p>
                    ${lastPostHtml}
                </div>
                <div class="forum-stats d-none d-md-block">
                    <div class="fw-bold">${stats.threadCount}</div>
                </div>
                <div class="forum-stats d-none d-md-block">
                    <div class="fw-bold">${stats.postCount}</div>
                </div>
                <div class="forum-arrow">❯</div>
            </div>
        `;
    });
};

// LEVEL 2: Unterkategorien (z.B. BMW, Honda, Touren-Vorschläge)
window.renderForumSubCategory = function(catId) {
    const category = allForumData.find(c => c.id === catId);
    if (!category) return;

    renderBreadcrumbs([{ label: category.title, onclick: null }]); 

    const container = document.getElementById('forum-container');
    
    // PRÜFUNG: Darf der User hier eine neue Kategorie (z.B. neue Marke) anlegen?
    let addCatBtn = "";
    const isAllowed = USER_EDITABLE_CATEGORIES.includes(catId);
    const isAdmin = (currentRole === 'admin');

    if (currentUser && (isAllowed || isAdmin)) {
        addCatBtn = `<button class="btn btn-outline-dark btn-sm float-end" onclick="openAddCategoryModal('${catId}')">+ Neue Kategorie</button>`;
    }

    container.innerHTML = `
        <div class="clearfix mb-3">
            <h2 class="fw-bold float-start">${category.title}</h2>
            ${addCatBtn}
        </div>
        <div class="d-none d-md-flex forum-header-row">
            <div style="flex-grow:1;">Thema</div>
            <div style="width:100px; text-align:center;">Themen</div>
            <div style="width:100px; text-align:center;">Beiträge</div>
            <div style="width:30px;"></div>
        </div>
    `;

    if (category.topics) {
        category.topics.forEach(topic => {
            const stats = getForumStats(t => t.topic === topic.title);
            let lastPostHtml = stats.lastPost ? `
                <div class="mt-1 small text-muted">
                    Letzter: <span class="text-dark fw-bold">${stats.lastPost.user}</span> 
                    <span class="text-secondary">(${stats.lastPost.date})</span>
                </div>` : `<small class="text-muted">Leer</small>`;

            container.innerHTML += `
                <div class="forum-row" style="cursor:pointer;" onclick="renderForumThreads('${topic.title}', '${category.id}')">
                    <div class="forum-icon">🔧</div>
                    <div class="forum-main">
                        <h5 class="fw-bold text-primary mb-0">${topic.title}</h5>
                        <p class="text-muted small mb-0">${topic.desc || ""}</p>
                        ${lastPostHtml}
                    </div>
                    <div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.threadCount}</div></div>
                    <div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.postCount}</div></div>
                    <div class="forum-arrow">❯</div>
                </div>`;
        });
    }
};

// LEVEL 3: Liste der Threads
window.renderForumThreads = async function(topicName, catId) {
    currentForumTopic = topicName;
    
    let breadcrumbs = [];
    if(catId) {
        const cat = allForumData.find(c => c.id === catId);
        if(cat) breadcrumbs.push({ label: cat.title, onclick: `renderForumSubCategory('${cat.id}')` });
    }
    breadcrumbs.push({ label: topicName, onclick: null });
    renderBreadcrumbs(breadcrumbs);

    const container = document.getElementById('forum-container');
    
    // BUTTON FIX: Der Button wird hier JEDES MAL neu erzeugt, nicht versteckt.
    let newThreadBtn = "";
    if (currentUser) {
        newThreadBtn = `
            <button class="btn btn-danger float-end" onclick="openNewThreadModal()">
                Neues Thema +
            </button>`;
    }

    container.innerHTML = `
        <div class="clearfix mb-3">
            <h3 class="fw-bold float-start">${topicName}</h3>
            ${newThreadBtn}
        </div>
        <div class="forum-header-row d-flex">
            <div style="flex-grow:1;">Thema / Ersteller</div>
            <div style="width:100px; text-align:center;">Antworten</div>
            <div style="width:150px; text-align:right;">Letzter Beitrag</div>
        </div>
        <div id="thread-list-area"><div class="text-center p-4"><div class="spinner-border text-danger"></div></div></div>
    `;

    try {
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        const threads = await response.json();
        const listArea = document.getElementById('thread-list-area');
        listArea.innerHTML = '';

        if (threads.length === 0) {
            listArea.innerHTML = `<div class="p-4 text-center text-muted">Noch keine Themen vorhanden.</div>`;
            return;
        }

        threads.sort((a, b) => (b.createdAt || b.date) - (a.createdAt || a.date));

        threads.forEach(thread => {
            listArea.innerHTML += `
                <div class="forum-row py-2" style="cursor:pointer;" onclick="renderThreadDetail('${thread.id}', '${thread.topic}')">
                    <div class="forum-icon">📄</div>
                    <div class="forum-main">
                        <div class="fw-bold text-dark">${thread.title}</div>
                        <div class="small text-muted">von ${thread.user} • ${thread.date}</div>
                    </div>
                    <div class="forum-stats fw-bold">${thread.replies || 0}</div>
                    <div class="text-end text-muted small" style="width:150px;">${thread.date}<br>by ${thread.user}</div>
                </div>`;
        });
    } catch (error) { console.error(error); }
};
// LEVEL 4: Thread Detail (Chat Ansicht) - Bleibt ähnlich, nur Breadcrumb dazu
window.renderThreadDetail = async function(threadId, topicName) {
    // Breadcrumbs suchen (etwas tricky rückwärts zu finden ohne ID, aber wir versuchen es)
    // Wir bauen einfach einen generischen Pfad
    renderBreadcrumbs([
        { label: topicName, onclick: `renderForumThreads('${topicName}')` },
        { label: "Beitrag lesen", onclick: null }
    ]);

    const container = document.getElementById('forum-container');
    const newBtn = document.getElementById('new-thread-btn');
    if(newBtn) newBtn.style.display = 'none';

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';

    try {
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        const threads = await response.json();
        const currentThread = threads.find(t => t.id === threadId);

        if (!currentThread) throw new Error("Beitrag nicht gefunden");

        container.innerHTML = `
            <h3 class="fw-bold mb-4">${currentThread.title}</h3>
        `;

        // A) Original Post
        const originalPost = `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-light border-bottom py-2 d-flex justify-content-between">
                    <div>
                        <span class="fw-bold text-danger">${currentThread.user}</span> 
                        <span class="text-muted small">schrieb am ${currentThread.date}:</span>
                    </div>
                    <div class="text-muted small">#1</div>
                </div>
                <div class="card-body">
                    <p class="card-text fs-5" style="white-space: pre-wrap;">${currentThread.text}</p>
                </div>
            </div>
        `;
        container.innerHTML += originalPost;

        // B) Antworten
        if (currentThread.repliesList && currentThread.repliesList.length > 0) {
            currentThread.repliesList.forEach((reply, idx) => {
                const replyHtml = `
                    <div class="card mb-3 border-0 shadow-sm ms-3 ms-md-5 bg-white">
                        <div class="card-header bg-white border-bottom-0 py-2 d-flex justify-content-between">
                            <div>
                                <span class="fw-bold text-dark">${reply.user}</span> 
                                <span class="text-muted small">antwortete am ${reply.date}:</span>
                            </div>
                            <div class="text-muted small">#${idx + 2}</div>
                        </div>
                        <div class="card-body pt-0">
                            <p class="mb-0" style="white-space: pre-wrap;">${reply.text}</p>
                        </div>
                    </div>
                `;
                container.innerHTML += replyHtml;
            });
        }

 // C) Antwort Formular
        if (currentUser) {
            container.innerHTML += `
                <div class="card mt-4 bg-light border-0">
                    <div class="card-body">
                        <h6 class="fw-bold mb-2">Antworten</h6>
                        <textarea id="replyText" class="form-control mb-2" rows="3" placeholder="Schreibe eine Antwort..."></textarea>
                        
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('😀', 'replyText')">😀</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('😂', 'replyText')">😂</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('👍', 'replyText')">👍</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('🏍️', 'replyText')">🏍️</button>
                            </div>
                            <button class="btn btn-danger" onclick="sendReply('${currentThread.id}', '${currentThread.topic}')">Antworten</button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML += `<div class="alert alert-warning mt-3">Bitte einloggen zum Antworten.</div>`;
        }

    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Beitrags.</div>';
    }
};


/* ==========================================
   GLOBAL EXPORTS
   ========================================== */
window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Löschen?")) return;
    alert("Gelöscht: " + id);
};

window.openNewThreadModal = function() {
    const topicInput = document.getElementById('threadTopicDisplay');
    if(topicInput) topicInput.value = currentForumTopic;
    const modalEl = document.getElementById('createThreadModal');
    if(modalEl) new bootstrap.Modal(modalEl).show();
};

window.openAddCategoryModal = function(catId) {
    // Hier kannst du ein neues Modal für "Kategorie hinzufügen" öffnen
    // Vorübergehend nutzen wir einen Prompt zum Testen:
    const newCatName = prompt("Name der neuen Kategorie (z.B. Ducati):");
    if(newCatName) {
        alert("Sende an Backend: Neue Kategorie '" + newCatName + "' für Haupt-ID: " + catId);
        // Hier käme später der fetch-Aufruf zum Backend
    }
};


window.filterTours = filterTours;
window.onCategoryChange = onCategoryChange;
window.onCountryChange = onCountryChange;
window.resetFilters = resetFilters;