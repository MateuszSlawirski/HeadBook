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

// WICHTIG: Startwerte setzen
let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let map = null;
let markers = []; 

/* ==========================================
   APP START (INIT)
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App startet...");

    // 1. Auth Listener: Reagiert SOFORT auf Login/Logout
    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        
        if (user) {
            console.log("✅ Eingeloggt:", user.email);
            // SOFORT UI updaten, nicht auf Server warten!
            updateUI(); 
            await syncUserWithBackend(user); 
        } else {
            console.log("ℹ️ Ausgeloggt");
            currentRole = "guest";
            if (window.location.pathname.includes('profil.html')) {
                window.location.href = 'index.html';
            }
            updateUI();
        }
    });

    // 2. Daten laden
    loadToursFromServer();

    // 3. Events registrieren
    setupEventListeners();
});

/* ==========================================
   AUTH & UI LOGIK
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
            updateUI(); // Nochmal updaten, falls Rolle anders ist
        }
    } catch (err) { 
        console.warn("Backend-Sync nicht möglich. Login bleibt aktiv.");
    }
}

function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const secureLinks = document.querySelectorAll('.auth-required');
    const addTourBtn = document.querySelector('[data-bs-target="#addTourModal"]');

    if (currentUser) {
        // --- EINGELOGGT ---
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
        // --- GAST ---
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        
        secureLinks.forEach(link => link.classList.add('d-none'));
        if(addTourBtn) addTourBtn.style.display = 'none';
    }
}

function fillProfilePageData() {
    const profileDisplay = document.getElementById('profile-email-display');
    if(profileDisplay && currentUser) {
        profileDisplay.innerText = currentUser.displayName || "Biker";
    }
}

function showDeleteButtons() {
    const deleteBtns = document.querySelectorAll('.delete-btn');
    deleteBtns.forEach(btn => {
        btn.style.display = (currentRole === 'admin') ? 'block' : 'none';
    });
}

/* ==========================================
   BUTTONS & EVENTS
   ========================================== */

function setupEventListeners() {
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = "index.html"; 
        });
    }

    // Modal Elemente
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
            // Hier war der Fehler: Das Formular lud die Seite neu, weil preventDefault fehlte 
            // oder authForm nicht gefunden wurde.
            const isRegisterMode = nameContainer && nameContainer.style.display === 'block';
            if (isRegisterMode) handleRegister();
            else handleLogin(e);
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
        // Modal schließen
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
        } else {
             throw new Error("Server Fehler: " + response.status);
        }
    } catch (err) {
        alert("Fehler beim Speichern: " + err.message);
    } finally {
        btn.disabled = false;
    }
}

/* ==========================================
   DATEN LADEN & FILTER LOGIK
   ========================================== */

async function loadToursFromServer() {
    const listContainer = document.getElementById('tours-container');
    if(listContainer) listContainer.innerHTML = '<div class="text-center mt-5">⏳ Lade Touren...</div>';

    try {
        const response = await fetch(`${API_URL}/tours`);
        if (!response.ok) throw new Error("Server antwortet nicht");
        toursData = await response.json();
    } catch (error) {
        console.error("API Fehler:", error);
        if(listContainer) listContainer.innerHTML = '<div class="alert alert-warning text-center">Keine Verbindung zur Datenbank (API fehlt).</div>';
    } finally {
        initMap();      
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

// 1. Initialisierung: Regionen füllen
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

// 2. Region gewählt -> Länder laden
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

// 3. Land gewählt -> Bundesländer laden
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
        if(toursData.length > 0) {
             listContainer.innerHTML = '<div class="text-center text-muted p-3">Keine passenden Touren gefunden.</div>';
        }
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
        // Klick auf Karte setzt Filter
        card.addEventListener('click', () => selectTourCard(tour));
        listContainer.appendChild(card);
    });
    
    showDeleteButtons();
}

// Klick auf Tour setzt Filter links
function selectTourCard(tour) {
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');

    if(tour.coords && map) map.flyTo(tour.coords, 10);

    if(tour.category) {
        catSelect.value = tour.category;
        onCategoryChange(); 
    }
    
    setTimeout(() => {
        if(tour.country) {
            countrySelect.value = tour.country;
            onCountryChange(); 
        }
        setTimeout(() => {
            if(tour.state) {
                stateSelect.value = tour.state;
                filterTours();
            }
        }, 50);
    }, 50);
}

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