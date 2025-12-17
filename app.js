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

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App startet...");
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            await syncUserWithBackend(user);
        } else {
            currentUser = null;
            currentRole = "guest";
            if (window.location.pathname.includes('profil.html')) {
                window.location.href = 'index.html';
            }
            updateUI();
        }
    });

    loadToursFromServer();
    setupEventListeners();
});

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
        }
    } catch (err) { console.error(err); } finally { updateUI(); }
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
            // WICHTIG: Wir entfernen d-none, damit es sichtbar wird
            link.classList.remove('d-none');
            // Zur Sicherheit auch inline styles löschen
            link.style.display = ''; 
        });

        if(userInfo) {
            userInfo.style.display = 'block';
            const displayName = currentUser.displayName || currentUser.email.split('@')[0];
            let roleBadge = '<span class="badge bg-secondary">USER</span>';
            if(currentRole === 'admin') roleBadge = '<span class="badge bg-danger">ADMIN</span>';
            userInfo.innerHTML = `Hallo, <b>${displayName}</b> ${roleBadge}`;
        }

        if(addTourBtn) {
             if (currentUser.emailVerified || currentRole === 'admin') {
                 addTourBtn.style.display = 'block';
             } else {
                 addTourBtn.style.display = 'none';
             }
        }
        fillProfilePageData();
    } else {
        // --- GAST ---
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        
        secureLinks.forEach(link => {
            // WICHTIG: Wir fügen d-none hinzu
            link.classList.add('d-none');
        });

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
        if(currentRole === 'admin' || currentRole === 'moderator') {
            btn.style.display = 'block';
        } else {
            btn.style.display = 'none';
        }
    });
}

function setupEventListeners() {
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            alert("Erfolgreich ausgeloggt.");
            window.location.href = "index.html"; 
        });
    }

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
            if (isRegisterMode) {
                handleRegister();
            } else {
                handleLogin(e);
            }
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
        await sendEmailVerification(cred.user);
        msg.innerHTML = `<span class="text-success">Willkommen <b>${nickname}</b>! Account erstellt. Bitte E-Mails prüfen.</span>`;
        setTimeout(() => window.location.reload(), 2000);
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
        modal.hide();
    } catch (error) {
        msg.innerHTML = `<span class="text-danger">Login fehlgeschlagen: ${error.message}</span>`;
    }
}

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
        if(listContainer) listContainer.innerHTML = '<p class="text-center text-danger">Konnte Daten nicht laden (Server offline?)</p>';
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
        if(tour.coords) {
            const marker = L.marker(tour.coords).addTo(map);
            marker.bindPopup(`<b>${tour.title}</b>`);
            markers.push(marker);
            marker.on('click', () => map.flyTo(tour.coords, 10));
        }
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
    showDeleteButtons();
}

async function handleAddTour(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
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
            const modalEl = document.getElementById('addTourModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            e.target.reset();
            filterTours();
            alert("Gespeichert!");
        }
    } catch (err) { alert("Fehler: " + err.message); } finally { btn.disabled = false; }
}

window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Als Admin wirklich löschen?")) return;
    alert("Backend Lösch-Befehl ID: " + id);
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
    const cat = document.getElementById('filter-category')?.value;
    if(!cat || cat === 'all') renderTours(toursData); 
    else renderTours(toursData.filter(t => t.category === cat));
}
window.filterTours = filterTours;
window.onCategoryChange = filterTours;