/* ==========================================
   IMPORTS & KONFIGURATION
   ========================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. FIREBASE KONFIGURATION (Hier deine Daten einfügen!) ---
const firebaseConfig = {
  apiKey: "AIzaSyD6iG-Lx0dAZRp4FRGBLhK7WmJPZ5s1kEs",
  authDomain: "riderpoint.firebaseapp.com",
  projectId: "riderpoint",
  storageBucket: "riderpoint.firebasestorage.app",
  messagingSenderId: "426779644316",
  appId: "1:426779644316:web:41f6f90d041ee6ff037859"
};

// --- 2. BACKEND URL (Azure) ---
const API_URL = "/api"; // Basis-URL für unser Backend

// --- 3. GLOBALE VARIABLEN ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let toursData = []; 
let currentUser = null;
let currentRole = "guest"; // Standard-Rolle
let map = null;
let markers = []; 

/* ==========================================
   APP START (INIT)
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App startet...");

    // 1. Auth Listener starten (Prüft Login-Status)
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            console.log("✅ Eingeloggt als:", user.email);
            // Rolle vom Azure Backend holen
            await syncUserWithBackend(user);
        } else {
            currentUser = null;
            currentRole = "guest";
            console.log("ℹ️ Ausgeloggt / Gast");
            updateUI();
        }
    });

    // 2. Touren laden
    loadToursFromServer();

    // 3. Button Events registrieren
    setupEventListeners();
});

/* ==========================================
   AUTHENTIFIZIERUNG & ROLLEN
   ========================================== */

async function syncUserWithBackend(firebaseUser) {
    try {
        // Wir fragen unser Azure Backend: "Wer ist das?"
        const response = await fetch(`${API_URL}/user-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                uid: firebaseUser.uid, 
                email: firebaseUser.email 
            })
        });
        
        if(response.ok) {
            const dbUser = await response.json();
            currentRole = dbUser.role || "user"; 
            console.log("👮 Rolle geladen:", currentRole);
        }
    } catch (err) {
        console.error("❌ Fehler beim Rollen-Sync:", err);
    } finally {
        updateUI(); // UI aktualisieren, egal ob es geklappt hat
    }
}

function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const addTourBtn = document.querySelector('[data-bs-target="#addTourModal"]');

    // UI Reset
    if(authBtn) authBtn.style.display = 'block';
    if(logoutBtn) logoutBtn.style.display = 'none';
    if(userInfo) userInfo.style.display = 'none';
    if(addTourBtn) addTourBtn.style.display = 'none'; // Erstmal ausblenden

    if (currentUser) {
        // --- EINGELOGGT ---
        authBtn.style.display = 'none';
        logoutBtn.style.display = 'block';
        userInfo.style.display = 'block';
        
        // Badge für Rolle
        let roleBadge = '<span class="badge bg-secondary">USER</span>';
        if(currentRole === 'admin') roleBadge = '<span class="badge bg-danger">ADMIN</span>';
        if(currentRole === 'moderator') roleBadge = '<span class="badge bg-primary">MOD</span>';

        // Badge für E-Mail Status
        let statusBadge = currentUser.emailVerified 
            ? '<span class="badge bg-success">Verifiziert</span>' 
            : '<span class="badge bg-warning text-dark">Unbestätigt</span>';

        userInfo.innerHTML = `<small>${currentUser.email}</small> ${roleBadge} ${statusBadge}`;

        // BERECHTIGUNG: Posten darf nur wer verifiziert ist (oder Admin/Mod)
        if (currentUser.emailVerified || currentRole === 'admin') {
             if(addTourBtn) addTourBtn.style.display = 'block';
        }
        
        // BERECHTIGUNG: Löschen-Buttons anzeigen (Admin/Mod)
        showDeleteButtons();
    }
}

function showDeleteButtons() {
    const deleteBtns = document.querySelectorAll('.delete-btn');
    deleteBtns.forEach(btn => {
        if(currentRole === 'admin' || currentRole === 'moderator') {
            btn.style.display = 'block';
        } else {
            btn.style.display = 'none';
        }
    });
}

/* ==========================================
   LOGIN / REGISTER LOGIK
   ========================================== */

function setupEventListeners() {
    // Registrieren Button im Modal
    const btnRegister = document.getElementById('btn-register');
    if(btnRegister) btnRegister.addEventListener('click', handleRegister);

    // Login Formular
    const authForm = document.getElementById('authForm');
    if(authForm) authForm.addEventListener('submit', handleLogin);

    // Logout Button (Navbar)
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            alert("Erfolgreich ausgeloggt.");
            window.location.reload();
        });
    }

    // Neue Tour Formular
    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

async function handleRegister() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('auth-message');

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await sendEmailVerification(cred.user);
        msg.innerHTML = `<span class="text-success">Account erstellt! <b>Bitte E-Mails prüfen.</b></span>`;
    } catch (error) {
        msg.innerHTML = `<span class="text-danger">${error.message}</span>`;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('auth-message');

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // Modal schließen
        const modalEl = document.getElementById('authModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
    } catch (error) {
        msg.innerHTML = `<span class="text-danger">Login fehlgeschlagen: ${error.message}</span>`;
    }
}

/* ==========================================
   TOUREN LADEN & ANZEIGEN
   ========================================== */

async function loadToursFromServer() {
    const listContainer = document.getElementById('tours-container');
    if(listContainer) listContainer.innerHTML = '<div class="text-center mt-5">⏳ Lade Touren...</div>';

    try {
        const response = await fetch(`${API_URL}/tours`);
        if (!response.ok) throw new Error("Fehler beim Laden");
        
        toursData = await response.json();
        
        initMap();      
        initFilters();  
        filterTours();  

    } catch (error) {
        console.error(error);
        if(listContainer) listContainer.innerHTML = '<p class="text-center text-danger">Konnte Daten nicht laden.</p>';
    }
}

function initMap() {
    if (map) return; 
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    map = L.map('map').setView([51.1657, 10.4515], 6); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

function renderTours(data) {
    const listContainer = document.getElementById('tours-container');
    if(!listContainer) return;
    listContainer.innerHTML = '';
    
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    data.forEach(tour => {
        // Marker
        if(tour.coords) {
            const marker = L.marker(tour.coords).addTo(map);
            marker.bindPopup(`<b>${tour.title}</b>`);
            markers.push(marker);
            marker.on('click', () => map.flyTo(tour.coords, 10));
        }

        // Karte (HTML)
        const card = document.createElement('div');
        card.className = 'mini-tour-card';
        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <h5 class="fw-bold m-0">${tour.title}</h5>
                <button class="btn btn-sm btn-danger delete-btn" style="display:none;" onclick="deleteTour('${tour.id}', event)">🗑️</button>
            </div>
            <div class="small text-muted mb-2">${tour.country} • ${tour.state}</div>
            <p class="small mb-0">${tour.desc || ""}</p>
        `;
        
        card.addEventListener('click', () => {
            if(tour.coords) map.flyTo(tour.coords, 10);
        });
        listContainer.appendChild(card);
    });
    
    // Nach dem Rendern: Löschbuttons prüfen
    showDeleteButtons();
}

/* ==========================================
   NEUE TOUR SPEICHERN
   ========================================== */

async function handleAddTour(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    // Einfache Zufallskoordinaten für Demo
    const lat = 47 + Math.random() * 5; 
    const lng = 7 + Math.random() * 5;

    const newTour = {
        title: document.getElementById('newTitle').value,
        category: document.getElementById('newRegion').value,
        country: document.getElementById('newCountry').value,
        state: document.getElementById('newState').value || "Community",
        km: document.getElementById('newKm').value,
        time: document.getElementById('newTime').value,
        desc: document.getElementById('newDesc').value,
        coords: [lat, lng]
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
            
            // Modal zu
            const modalEl = document.getElementById('addTourModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            
            e.target.reset();
            filterTours();
            alert("Gespeichert!");
        }
    } catch (err) {
        alert("Fehler: " + err.message);
    } finally {
        btn.disabled = false;
    }
}

/* ==========================================
   FILTER & EXTRAS
   ========================================== */

// Globale Delete Funktion (damit HTML onclick sie findet)
window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Als Admin wirklich löschen?")) return;
    alert("Hier würde jetzt der Lösch-Befehl an das Backend gehen für ID: " + id);
    // TODO: fetch('/api/tour-delete', { method: 'DELETE' ... })
};

function initFilters() {
    const catSelect = document.getElementById('filter-category');
    if(!catSelect) return;
    const cats = [...new Set(toursData.map(t => t.category))].sort();
    catSelect.innerHTML = '<option value="all">Bitte wählen...</option>';
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.innerText = c;
        catSelect.appendChild(opt);
    });
}

function filterTours() {
    // (Vereinfachte Filterlogik für Übersichtlichkeit)
    const cat = document.getElementById('filter-category')?.value;
    if(!cat || cat === 'all') {
        renderTours(toursData); // Zeige alle wenn kein Filter
    } else {
        renderTours(toursData.filter(t => t.category === cat));
    }
}

// Global verfügbar machen für HTML onchange Events
window.filterTours = filterTours;
window.onCategoryChange = filterTours;