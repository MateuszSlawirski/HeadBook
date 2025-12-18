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
// const API_URL = "http://localhost:7071/api"; // Nur zum lokalen Testen aktivieren!

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let map = null;
let markers = []; 
let currentForumTopic = null; 

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

    // 2. LOGIN / REGISTER SWITCH
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
            const btn = e.target.querySelector('button');

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
   HELPER FUNCTIONS (Register, Login, AddTour)
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
window.insertEmoji = function(emoji) {
    const textarea = document.getElementById('threadText');
    if (textarea) {
        textarea.value += emoji;
        textarea.focus();
    }
};

/* ==========================================
   FORUM LOGIK (Level 1 -> 2 -> 3 -> 4)
   ========================================== */

let allForumData = []; 
let allThreadsCache = []; // Wir speichern alle Threads, um "Letzte Beiträge" anzuzeigen
let currentCategoryId = null; // Merkt sich Level 2 für den Zurück-Button

async function loadForumData() {
    const container = document.getElementById('forum-container');
    if(!container) return;
    
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';
    
    try {
        // 1. Kategorien laden
        const catResponse = await fetch(`${API_URL}/forum`);
        if (!catResponse.ok) throw new Error("Kategorie-Fehler");
        allForumData = await catResponse.json();

        // 2. ALLE Threads laden (für die Vorschau auf der Startseite)
        // Wir holen einfach alle (ohne ?topic=...), damit wir suchen können
        const threadResponse = await fetch(`${API_URL}/threads`); 
        if (threadResponse.ok) {
            allThreadsCache = await threadResponse.json();
        }

        renderForumHome();
    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden.</div>';
    }
}

// LEVEL 1: Hauptübersicht (Mit Vorschau des letzten Posts)
window.renderForumHome = function() {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    if(!title) return;

    title.innerText = "Community Forum";
    subtitle.innerText = "Wähle einen Bereich.";
    
    // Auf Level 1 gibt es keine Zurück-Buttons
    backBtn.style.display = 'none';
    backBtn.innerText = "⬅ Übersicht"; 
    backBtn.onclick = null;

    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    allForumData.forEach(cat => {
        // Suche den allerneuesten Thread für diese Kategorie
        let latestThreadInfo = '<small class="text-muted">Noch keine Beiträge</small>';
        
        // Wir suchen Threads, deren Topic in dieser Kategorie vorkommt
        // Dazu sammeln wir alle Topic-Namen dieser Kategorie
        const catTopicNames = cat.topics.map(t => t.title);
        
        // Filtern: Threads die zu dieser Kategorie gehören
        const catThreads = allThreadsCache.filter(t => catTopicNames.includes(t.topic));
        
        // Sortieren: Neueste zuerst (wir nehmen an, das Datum ist YYYY-MM-DD, das lässt sich gut sortieren)
        catThreads.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (catThreads.length > 0) {
            const last = catThreads[0];
            // Text kürzen, falls zu lang
            const shortTitle = last.title.length > 30 ? last.title.substring(0, 30) + "..." : last.title;
            latestThreadInfo = `<small class="text-primary fw-bold">Neu: ${shortTitle}</small> <small class="text-muted">(${last.date})</small>`;
        }

        const item = document.createElement('a');
        item.className = 'list-group-item list-group-item-action py-3 d-flex justify-content-between align-items-center';
        item.style.cursor = 'pointer';
        item.innerHTML = `
            <div>
                <h5 class="mb-1 fw-bold">${cat.title}</h5>
                ${latestThreadInfo}
            </div>
            <span class="text-muted">❯</span>
        `;
        item.onclick = () => renderForumSubCategory(cat.id);
        container.appendChild(item);
    });
};

// LEVEL 2: Unterkategorien (z.B. Liste der Marken)
window.renderForumSubCategory = function(catId) {
    currentCategoryId = catId; // Merken für später!
    const category = allForumData.find(c => c.id === catId);
    if (!category) return;

    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    title.innerText = category.title;
    subtitle.innerText = "Wähle ein Thema.";
    
    // Button: Zurück zur Übersicht
    backBtn.style.display = 'inline-block';
    backBtn.innerText = "⬅ Übersicht";
    backBtn.onclick = renderForumHome;
    
    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    if (category.topics) {
        category.topics.forEach(topic => {
            // Zählen wie viele Beiträge es gibt (aus dem Cache)
            const count = allThreadsCache.filter(t => t.topic === topic.title).length;
            
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action py-3 d-flex justify-content-between align-items-center';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <div>
                    <h6 class="mb-1 fw-bold text-primary">${topic.title}</h6>
                    <small class="text-muted">${topic.desc}</small>
                </div>
                <div class="text-end">
                    <span class="badge bg-light text-dark border">${count} Beiträge</span>
                    <span class="text-muted ms-2">❯</span>
                </div>
            `;
            item.onclick = () => renderForumThreads(topic.title);
            container.appendChild(item);
        });
    }
};

// LEVEL 3: Liste der Threads (Diskussionen)
window.renderForumThreads = async function(topicName) {
    currentForumTopic = topicName; 
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    title.innerText = topicName;
    subtitle.innerText = "Lade Diskussionen...";
    
    // Button: Zurück zur Kategorie (Level 2)
    // Wir schauen in allForumData, wie die Kategorie hieß, zu der wir gehören
    let parentCatName = "Zurück";
    if (currentCategoryId) {
        const parentCat = allForumData.find(c => c.id === currentCategoryId);
        if(parentCat) parentCatName = "⬅ " + parentCat.title;
    }

    backBtn.style.display = 'inline-block';
    backBtn.innerText = parentCatName; // Dynamischer Text (z.B. "Zurück zu Bikes")
    backBtn.onclick = () => {
        if(currentCategoryId) renderForumSubCategory(currentCategoryId);
        else renderForumHome();
    };
    
    newThreadBtn.style.display = 'inline-block';
    newThreadBtn.onclick = () => {
        const topicInput = document.getElementById('threadTopicDisplay');
        if(topicInput) topicInput.value = currentForumTopic;
        const modalEl = document.getElementById('createThreadModal');
        if(modalEl) new bootstrap.Modal(modalEl).show();
    };
    
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';

    try {
        // Daten neu laden (damit wir auch ganz frische sehen)
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        if (!response.ok) throw new Error("Netzwerk Fehler");
        const threads = await response.json();

        // Update Cache
        // (Optional: Wir könnten den Cache hier aktualisieren, ist aber nicht zwingend)

        container.innerHTML = ''; 
        if (threads.length === 0) {
            container.innerHTML = `
                <div class="p-5 text-center text-muted">
                    <h5>Noch nichts los hier. 🦗</h5>
                    <p>Sei der Erste, der etwas zu ${topicName} schreibt!</p>
                </div>`;
            subtitle.innerText = "Keine Beiträge";
            return;
        }

        subtitle.innerText = `${threads.length} Diskussionen gefunden`;
        threads.forEach(thread => {
            const item = document.createElement('div');
            item.className = 'list-group-item py-3';
            item.innerHTML = `
                <div class="d-flex justify-content-between">
                    <h6 class="mb-1 fw-bold">
                        <a href="#" class="text-decoration-none text-dark" onclick="renderThreadDetail('${thread.id}', '${thread.topic}')">
                            ${thread.title}
                        </a>
                    </h6>
                    <span class="badge bg-light text-dark border">${thread.replies || 0} Antw.</span>
                </div>
                <small class="text-muted">Erstellt von <b>${thread.user}</b> • ${thread.date || 'Heute'}</small>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Konnte Beiträge nicht laden.</div>';
    }
};

// LEVEL 4: Thread Detail (Beitrag lesen & antworten)
window.renderThreadDetail = async function(threadId, topicName) {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';
    newThreadBtn.style.display = 'none'; 
    
    // Zurück-Button Logik: Zurück zur Liste der Threads (Level 3)
    backBtn.style.display = 'inline-block';
    backBtn.innerText = "⬅ Zurück zum Thema";
    backBtn.onclick = () => renderForumThreads(topicName);

    try {
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        const threads = await response.json();
        const currentThread = threads.find(t => t.id === threadId);

        if (!currentThread) throw new Error("Beitrag nicht gefunden");

        title.innerText = currentThread.title;
        subtitle.innerText = `Gestartet von ${currentThread.user}`;

        container.innerHTML = '';

        // A) Original Post
        const originalPost = `
            <div class="card mb-3 border-primary shadow-sm">
                <div class="card-header bg-primary text-white d-flex justify-content-between">
                    <span>👤 ${currentThread.user}</span>
                    <small>${currentThread.date}</small>
                </div>
                <div class="card-body bg-light">
                    <p class="card-text fs-5" style="white-space: pre-wrap;">${currentThread.text}</p>
                </div>
            </div>
        `;
        container.innerHTML += originalPost;

        // B) Antworten
        if (currentThread.repliesList && currentThread.repliesList.length > 0) {
            currentThread.repliesList.forEach(reply => {
                const replyHtml = `
                    <div class="card mb-3 border-0 ms-5 shadow-sm" style="background-color: #f8f9fa;">
                        <div class="card-body py-2">
                            <div class="d-flex justify-content-between mb-1">
                                <strong class="small text-primary">↪ ${reply.user}</strong>
                                <small class="text-muted" style="font-size:0.7em;">${reply.date}</small>
                            </div>
                            <p class="mb-0" style="white-space: pre-wrap;">${reply.text}</p>
                        </div>
                    </div>
                `;
                container.innerHTML += replyHtml;
            });
        } else {
            container.innerHTML += `<div class="text-center text-muted small my-4">Noch keine Antworten.</div>`;
        }

        // C) Antwort-Formular
        if (currentUser) {
            const replyForm = `
                <div class="mt-4 pt-3 border-top">
                    <h6 class="fw-bold mb-3">Antworten</h6>
                    <textarea id="replyText" class="form-control mb-2" rows="3" placeholder="Schreibe eine Antwort..."></textarea>
                    <button class="btn btn-primary btn-sm" onclick="sendReply('${currentThread.id}', '${currentThread.topic}')">
                        Senden ✈️
                    </button>
                </div>
            `;
            container.innerHTML += replyForm;
        } else {
            container.innerHTML += `
                <div class="alert alert-warning mt-4 text-center">
                    Bitte <a href="#" onclick="document.getElementById('btn-switch-mode').click()" data-bs-toggle="modal" data-bs-target="#authModal">einloggen</a>, um zu antworten.
                </div>
            `;
        }

    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Beitrags.</div>';
    }
};

// HELPER: Antwort absenden
window.sendReply = async function(threadId, topic) {
    const text = document.getElementById('replyText').value;
    if (!text.trim()) return alert("Bitte Text eingeben!");

    const btn = document.querySelector('button[onclick^="sendReply"]');
    if(btn) { btn.disabled = true; btn.innerText = "Sende..."; }

    try {
        const replyData = {
            id: threadId,
            topic: topic,
            text: text,
            user: currentUser.displayName || "Unbekannt"
        };

        const response = await fetch(`${API_URL}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(replyData)
        });

        if (response.ok) {
            renderThreadDetail(threadId, topic);
        } else {
            throw new Error("Fehler beim Senden");
        }
    } catch (err) {
        alert(err.message);
        if(btn) { btn.disabled = false; btn.innerText = "Senden ✈️"; }
    }
};

/* ==========================================
   GLOBAL EXPORTS (Dies muss am Ende bleiben)
   ========================================== */
window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Löschen?")) return;
    alert("Gelöscht: " + id);
};

window.filterTours = filterTours;
window.onCategoryChange = onCategoryChange;
window.onCountryChange = onCountryChange;
window.resetFilters = resetFilters;