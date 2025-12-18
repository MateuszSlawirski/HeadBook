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

/* ==========================================
   APP START
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 SPA startet...");

    // Initial Map Setup (auch wenn versteckt)
    initMap();

    // Listener
    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        if (user) {
            updateUI(); 
            await syncUserWithBackend(user); 
        } else {
            currentRole = "guest";
            // Wer ausgeloggt ist, darf Profil nicht sehen -> Ab nach Hause
            if (getActivePage() === 'profile') {
                navigateTo('home');
            }
            updateUI();
        }
    });

    loadToursFromServer();
    loadForumData(); // <--- Forum starten!
    setupEventListeners();
    
    // Startseite laden (oder das was im Hash steht)
    const startPage = window.location.hash.replace('#', '') || 'home';
    navigateTo(startPage);
});

/* ==========================================
   ROUTER (DAS HERZSTÜCK FÜR KEIN FLACKERN)
   ========================================== */

function navigateTo(pageId) {
    // 1. Alle Seiten verstecken
    document.querySelectorAll('.page-section').forEach(el => {
        el.classList.remove('active');
    });

    // 2. Nav-Links deaktivieren
    document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('active');
    });

    // 3. Gewünschte Seite anzeigen
    const target = document.getElementById(`page-${pageId}`);
    if (target) {
        target.classList.add('active');
        
        // Menüpunkt aktiv setzen
        const navLink = document.getElementById(`nav-${pageId}`);
        if(navLink) navLink.classList.add('active');

        // URL anpassen (ohne Reload)
        window.location.hash = pageId;

        // SPEZIALBEHANDLUNG: Wenn Touren angezeigt werden, Karte aktualisieren!
        if (pageId === 'tours' && map) {
            setTimeout(() => { map.invalidateSize(); }, 100);
        }
    }
}

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}

// Global verfügbar machen für HTML onclicks
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
        // LOGGED IN
        if(authBtn) authBtn.style.display = 'none'; 
        if(logoutBtn) logoutBtn.style.display = 'block';

        secureLinks.forEach(link => {
            link.classList.remove('d-none');
            link.style.display = ''; // Reset style
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
        // GAST
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        
        secureLinks.forEach(link => link.classList.add('d-none'));
        if(addTourBtn) addTourBtn.style.display = 'none';
        
        // Wenn man auf einer geschützten Seite war, weg da
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
    // Logout
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            navigateTo('home');
        });
    }

    // Modal Logic
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

    if(authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const isRegisterMode = nameContainer && nameContainer.style.display === 'block';
            if (isRegisterMode) handleRegister(); else handleLogin(e);
        });
    }

    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

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
   FORUM NAVIGATOR (Level 1 -> 2 -> 3)
   ========================================== */

let allForumData = []; // Zwischenspeicher

async function loadForumData() {
    const container = document.getElementById('forum-container');
    if(!container) return;
    
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';

    try {
        const response = await fetch(`${API_URL}/forum`);
        if (!response.ok) throw new Error("API Fehler");
        allForumData = await response.json();
        
        // Startseite anzeigen (Level 1)
        renderForumHome();

    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden.</div>';
    }
}

// LEVEL 1: Die Hauptübersicht
window.renderForumHome = function() {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    if(!title) return; // Falls User noch nicht auf Forum war

    title.innerText = "Community Forum";
    subtitle.innerText = "Wähle einen Bereich.";
    backBtn.style.display = 'none';
    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    allForumData.forEach(cat => {
        const item = document.createElement('a');
        item.className = 'list-group-item list-group-item-action py-3 d-flex justify-content-between align-items-center';
        item.style.cursor = 'pointer';
        item.innerHTML = `
            <div>
                <h5 class="mb-1 fw-bold">${cat.title}</h5>
                <small class="text-muted">Kategorien anzeigen</small>
            </div>
            <span class="text-muted">❯</span>
        `;
        item.onclick = () => renderForumSubCategory(cat.id);
        container.appendChild(item);
    });
};

// LEVEL 2: Unterkategorien
window.renderForumSubCategory = function(catId) {
    const category = allForumData.find(c => c.id === catId);
    if (!category) return;

    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    title.innerText = category.title;
    subtitle.innerText = "Wähle ein Thema.";
    backBtn.style.display = 'inline-block';
    backBtn.onclick = renderForumHome;
    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    if (category.topics) {
        category.topics.forEach(topic => {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action py-3 d-flex justify-content-between align-items-center';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <div>
                    <h6 class="mb-1 fw-bold text-primary">${topic.title}</h6>
                    <small class="text-muted">${topic.desc}</small>
                </div>
                <span class="text-muted">❯</span>
            `;
            item.onclick = () => renderForumThreads(topic.title);
            container.appendChild(item);
        });
    }
};

// LEVEL 3: Threads (Diskussionen)
window.renderForumThreads = function(topicName) {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    title.innerText = topicName;
    subtitle.innerText = "Aktuelle Diskussionen";
    
    backBtn.style.display = 'inline-block';
    backBtn.onclick = renderForumHome; 
    
    newThreadBtn.style.display = 'inline-block';
    
    container.innerHTML = '';

    // DEMO DATEN (Später aus Datenbank)
    const fakeThreads = [
        { title: "Welches Öl für die " + topicName + "?", user: "BikerMax", replies: 12 },
        { title: "Treffen am Wochenende?", user: "GhostRider", replies: 5 }
    ];

    fakeThreads.forEach(thread => {
        const item = document.createElement('div');
        item.className = 'list-group-item py-3';
        item.innerHTML = `
            <div class="d-flex justify-content-between">
                <h6 class="mb-1 fw-bold"><a href="#" class="text-decoration-none text-dark">${thread.title}</a></h6>
                <small class="text-muted">${thread.replies} Antworten</small>
            </div>
            <small class="text-muted">Erstellt von ${thread.user}</small>
        `;
        container.appendChild(item);
    });

    if (fakeThreads.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted">Noch keine Beiträge. Sei der Erste!</div>';
    }
};

// GLOBAL EXPORTS
window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Löschen?")) return;
    alert("Gelöscht: " + id);
};

window.filterTours = filterTours;
window.onCategoryChange = onCategoryChange;
window.onCountryChange = onCountryChange;
window.resetFilters = resetFilters;