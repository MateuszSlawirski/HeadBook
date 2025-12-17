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
    sendEmailVerification,
    updateProfile // <--- NEU: Wichtig für den Nicknamen
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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

// --- HIER IST DIE NEUE UPDATE UI LOGIK ---
function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    
    // Alle "geheimen" Menüpunkte finden (Klasse 'auth-required')
    const secureLinks = document.querySelectorAll('.auth-required');

    // 1. Erstmal alles verstecken (Standard-Zustand: Gast)
    if(authBtn) authBtn.style.display = 'block';     // Login-Button zeigen
    if(logoutBtn) logoutBtn.style.display = 'none';  // Logout verstecken
    if(userInfo) userInfo.style.display = 'none';    // User-Info verstecken
    
    // Geheime Links ausblenden
    secureLinks.forEach(link => link.style.display = 'none');

    // 2. Wenn User eingeloggt ist -> Alles anzeigen
    if (currentUser) {
        // Geheime Links wieder sichtbar machen
        secureLinks.forEach(link => {
            link.style.display = 'block'; 
        });

        if(authBtn) authBtn.style.display = 'none'; // Login-Button weg
        
        // Logout Button anzeigen
        if(logoutBtn) logoutBtn.style.display = 'block';

        if(userInfo) {
            userInfo.style.display = 'block';
            
            // Nickname anzeigen (oder Email, falls kein Name da ist)
            const displayName = currentUser.displayName || currentUser.email.split('@')[0];
            
            let roleBadge = '<span class="badge bg-secondary">USER</span>';
            if(currentRole === 'admin') roleBadge = '<span class="badge bg-danger">ADMIN</span>';

            userInfo.innerHTML = `Hallo, <b>${displayName}</b> ${roleBadge}`;
        }

        // Add Tour Button nur für Verifizierte
        const addTourBtn = document.querySelector('[data-bs-target="#addTourModal"]');
        if(addTourBtn) {
             if (currentUser.emailVerified || currentRole === 'admin') {
                 addTourBtn.style.display = 'block';
             } else {
                 addTourBtn.style.display = 'none';
             }
        }

        // Profil-Seite Daten füllen (falls wir gerade auf profil.html sind)
        fillProfilePageData();
    }
}

// Hilfsfunktion für die Profil-Seite
function fillProfilePageData() {
    const profileDisplay = document.getElementById('profile-email-display');
    const profileEmailInput = document.getElementById('profile-email-input');
    const profileRoleInput = document.getElementById('profile-role-input');
    const profileBadges = document.getElementById('profile-badges');
    const profileDateInput = document.getElementById('profile-date-input');

    if(profileDisplay && currentUser) {
        profileDisplay.innerText = currentUser.displayName || "Biker";
        if(profileEmailInput) profileEmailInput.value = currentUser.email;
        if(profileRoleInput) profileRoleInput.value = currentRole.toUpperCase();
        
        if(currentUser.metadata.creationTime && profileDateInput) {
            profileDateInput.value = new Date(currentUser.metadata.creationTime).toLocaleDateString('de-DE');
        }

        let badgesHtml = '';
        if(currentRole === 'admin') badgesHtml += '<span class="badge bg-danger me-1">Admin</span>';
        if(currentUser.emailVerified) badgesHtml += '<span class="badge bg-success">Verifiziert</span>';
        if(profileBadges) profileBadges.innerHTML = badgesHtml;
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
   LOGIN / REGISTER LOGIK (NEU)
   ========================================== */

function setupEventListeners() {
    // 1. Logout Button
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            alert("Erfolgreich ausgeloggt.");
            window.location.href = "index.html"; // Zurück zur Startseite
        });
    }

    // 2. Auth Formular Logik (Login vs. Register umschalten)
    const switchBtn = document.getElementById('btn-switch-mode');
    const nameContainer = document.getElementById('authNameContainer');
    const submitBtn = document.getElementById('btn-submit-auth');
    const authForm = document.getElementById('authForm');
    const modalTitle = document.querySelector('.modal-title');

    // Umschalten zwischen Login und Registrieren
    if(switchBtn && nameContainer) {
        switchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Prüfen ob das Namensfeld gerade sichtbar ist (style.display)
            const isRegisterMode = nameContainer.style.display === 'block';

            if(isRegisterMode) {
                // ZURÜCK ZUM LOGIN
                nameContainer.style.display = 'none';
                submitBtn.innerText = "Einloggen";
                switchBtn.innerText = "Hier registrieren";
                if(modalTitle) modalTitle.innerText = "Anmelden";
            } else {
                // ZUM REGISTRIEREN WECHSELN
                nameContainer.style.display = 'block';
                submitBtn.innerText = "Kostenlos Registrieren";
                switchBtn.innerText = "Zurück zum Login";
                if(modalTitle) modalTitle.innerText = "Neues Konto erstellen";
            }
        });
    }

    // Formular Absenden
    if(authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Wir entscheiden anhand der Sichtbarkeit des Namensfeldes, was zu tun ist
            const isRegisterMode = nameContainer && nameContainer.style.display === 'block';
            
            if (isRegisterMode) {
                handleRegister();
            } else {
                handleLogin(e);
            }
        });
    }

    // Neue Tour Formular
    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

// --- NEUE REGISTRIERUNG MIT NICKNAME ---
async function handleRegister() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nickname = document.getElementById('authName').value; // Den Namen holen
    const msg = document.getElementById('auth-message');

    // Sicherheitscheck: Name darf nicht leer sein
    if (!nickname || nickname.trim() === "") {
        msg.innerHTML = `<span class="text-danger">Bitte wähle einen Nickname!</span>`;
        return;
    }

    try {
        // 1. User erstellen
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        
        // 2. Nickname in Firebase speichern (Profil-Update)
        await updateProfile(cred.user, {
            displayName: nickname
        });

        // 3. Verifizierungs-Mail senden
        await sendEmailVerification(cred.user);
        
        msg.innerHTML = `<span class="text-success">Willkommen <b>${nickname}</b>! Account erstellt. Bitte E-Mails prüfen.</span>`;
        
        // Seite neu laden nach 2 Sekunden
        setTimeout(() => window.location.reload(), 2000);

    } catch (error) {
        msg.innerHTML = `<span class="text-danger">${error.message}</span>`;
    }
}

async function handleLogin(e) {
    // e.preventDefault() ist hier nicht nötig, da setupEventListeners das schon macht,
    // schadet aber auch nicht.
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