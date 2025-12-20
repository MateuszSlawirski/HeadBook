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

// STATE VARIABLES
let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 

// MAP STATE
let map = null;
let markers = []; 
let currentRouteLayer = null; 
let tempStartMarker = null;   
let tempEndMarker = null;     
let pickingMode = null;       

// FORUM STATE
let currentForumTopic = null; 
let currentCategoryId = null; 
let allForumData = []; 
let allThreadsCache = []; 

const USER_EDITABLE_CATEGORIES = ["bikes", "garage", "tours"];

/* ==========================================
   APP START
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        if (user) {
            updateUI(); 
            await syncUserWithBackend(user); 
        } else {
            currentRole = "guest";
            if (getActivePage() === 'profile') navigateTo('home');
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
   ROUTER & NAVIGATION
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

        if (pageId === 'forum') renderForumHome();
        
        // FEATURE: Refresh bei Klick auf "Touren"
        if (pageId === 'tours') {
            resetFilters();      // Filter zurücksetzen
            resetMapMarkers();   // Blaue Route entfernen
            
            // Karte zurücksetzen
            if (map) {
                setTimeout(() => { 
                    map.invalidateSize(); 
                    map.setView([51.16, 10.45], 6); // Zurück zur Mitte DE
                }, 200);
            }
        }
    }
}
window.navigateTo = navigateTo;

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}

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

    if (currentUser) {
        if(authBtn) authBtn.style.display = 'none'; 
        if(logoutBtn) logoutBtn.style.display = 'block';
        secureLinks.forEach(link => { link.classList.remove('d-none'); link.style.display = ''; });
        if(userInfo) {
            userInfo.style.display = 'block';
            const displayName = currentUser.displayName || currentUser.email.split('@')[0];
            userInfo.innerHTML = `Hallo, <b>${displayName}</b>`;
        }
    } else {
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        secureLinks.forEach(link => link.classList.add('d-none'));
    }
}

window.openAddTourModal = () => {
    if (!currentUser) {
        const modal = new bootstrap.Modal(document.getElementById('authModal'));
        modal.show();
        const msg = document.getElementById('auth-message');
        if(msg) msg.innerHTML = '<span class="text-danger fw-bold">Bitte erst einloggen!</span>';
    } else {
        const modal = new bootstrap.Modal(document.getElementById('addTourModal'));
        modal.show();
    }
};

/* ==========================================
   EVENT LISTENERS
   ========================================== */

function setupEventListeners() {
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) btnLogout.addEventListener('click', async () => { await signOut(auth); navigateTo('home'); });

    const authForm = document.getElementById('authForm');
    if(authForm) authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const isReg = document.getElementById('authNameContainer').style.display === 'block';
        if (isReg) handleRegister(); else handleLogin(e);
    });

    const createThreadForm = document.getElementById('createThreadForm');
    if (createThreadForm) {
        createThreadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return alert("Bitte logge dich erst ein!");
            const title = document.getElementById('threadTitle').value;
            const text = document.getElementById('threadText').value;
            try {
                const response = await fetch(`${API_URL}/threads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: currentForumTopic, title, text, user: currentUser.displayName || "Unbekannt" })
                });
                if (response.ok) {
                    bootstrap.Modal.getInstance(document.getElementById('createThreadModal')).hide();
                    e.target.reset();
                    await loadForumData(); 
                    await renderForumThreads(currentForumTopic, currentCategoryId); 
                }
            } catch (err) { alert(err.message); }
        });
    }

    const addCategoryForm = document.getElementById('addCategoryForm');
    if (addCategoryForm) {
        addCategoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mainCatId = document.getElementById('mainCatIdInput').value;
            const title = document.getElementById('newCatTitle').value;
            const desc = document.getElementById('newCatDesc').value;
            try {
                const response = await fetch(`${API_URL}/forum/category`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mainCatId, title, desc })
                });
                if (response.ok) {
                    bootstrap.Modal.getInstance(document.getElementById('addCategoryModal')).hide();
                    e.target.reset();
                    await loadForumData();
                    renderForumSubCategory(mainCatId);
                }
            } catch (err) { alert(err.message); }
        });
    }

    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

/* ==========================================
   TOUREN & KARTEN LOGIK
   ========================================== */

async function loadToursFromServer() {
    try {
        const response = await fetch(`${API_URL}/tours`);
        if (response.ok) toursData = await response.json();
    } catch (error) { console.warn("Tours offline"); } finally { initFilters(); filterTours(); }
}

function initMap() {
    if (map) return; 
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    
    map = L.map('map').setView([51.16, 10.45], 6); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors' 
    }).addTo(map);

    map.on('click', onMapClick);
}

function onMapClick(e) {
    if (!pickingMode) return;
    const latlng = e.latlng;
    const modalEl = document.getElementById('addTourModal');

    if (pickingMode === 'start') {
        if (tempStartMarker) map.removeLayer(tempStartMarker);
        tempStartMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup("Start").openPopup();
        
        const btn = document.getElementById('btn-pick-start');
        btn.classList.remove('btn-outline-danger');
        btn.classList.add('btn-success');
        btn.innerHTML = "Start gesetzt ✓";
        
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        pickingMode = null;

    } else if (pickingMode === 'end') {
        if (tempEndMarker) map.removeLayer(tempEndMarker);
        tempEndMarker = L.marker(latlng, { draggable: true }).addTo(map).bindPopup("Ziel").openPopup();
        
        const btn = document.getElementById('btn-pick-end');
        btn.classList.remove('btn-outline-danger');
        btn.classList.add('btn-success');
        btn.innerHTML = "Ziel gesetzt ✓";
        
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        pickingMode = null;

        if (tempStartMarker && tempEndMarker) {
            calculateRoutePreview(tempStartMarker.getLatLng(), tempEndMarker.getLatLng());
        }
    }
}

window.startPickLocation = (mode) => {
    pickingMode = mode; 
    const modalEl = document.getElementById('addTourModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide(); 
};

async function calculateRoutePreview(start, end) {
    document.getElementById('newDesc').placeholder = "Berechne Route...";
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;

    // 1. OSRM Route holen
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const km = (route.distance / 1000).toFixed(1);
            const hours = Math.floor(route.duration / 3600);
            const minutes = Math.floor((route.duration % 3600) / 60);
            
            document.getElementById('newKm').value = km;
            document.getElementById('newTime').value = `${hours}h ${minutes}min`;
            
            if (currentRouteLayer) map.removeLayer(currentRouteLayer);
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            currentRouteLayer = L.polyline(coords, { color: 'blue', weight: 5 }).addTo(map);
            map.fitBounds(currentRouteLayer.getBounds());
            window.tempRouteGeometry = coords; 
            
            // 2. FEATURE: Automatische Ländererkennung (Reverse Geocoding)
            await detectCountry(start.lat, start.lng);
        }
    } catch (e) {
        console.error("Routing Fehler:", e);
        alert("Konnte Route nicht berechnen (Server evtl. ausgelastet).");
    }
}

// FEATURE: Automatisch Land & Region erkennen
async function detectCountry(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Riderpoint-App' } });
        const data = await response.json();
        
        if (data && data.address) {
            const country = data.address.country;
            const state = data.address.state || data.address.county || "";
            
            // Felder füllen
            const countrySelect = document.getElementById('newCountry');
            const regionSelect = document.getElementById('newRegion');
            const stateInput = document.getElementById('newState');
            
            // Land setzen (wenn in der Liste, sonst 'Deutschland' als Fallback oder manuell)
            // Wir prüfen, ob der Text grob passt
            if (country.includes("Deutschland") || country.includes("Germany")) countrySelect.value = "Deutschland";
            else if (country.includes("Österreich") || country.includes("Austria")) countrySelect.value = "Österreich";
            else if (country.includes("Schweiz") || country.includes("Switzerland")) countrySelect.value = "Schweiz";
            else {
                // Wenn es ein anderes Land ist, fügen wir es dynamisch hinzu
                const opt = document.createElement('option');
                opt.value = country;
                opt.text = country;
                opt.selected = true;
                countrySelect.appendChild(opt);
            }

            // Region setzen (Logik: Europa vs Welt)
            // Hier stark vereinfacht: Wir nehmen an alles ist Europa für diesen Test
            regionSelect.value = "Europa";
            
            // Bundesland/Ort
            stateInput.value = state;

            console.log("Automatisch erkannt:", country, state);
        }
    } catch (e) {
        console.warn("Konnte Land nicht automatisch erkennen:", e);
    }
}

async function handleAddTour(e) {
    e.preventDefault();
    if (!currentUser) return alert("Bitte logge dich ein.");

    const title = document.getElementById('newTitle').value;
    const region = document.getElementById('newRegion').value;
    const country = document.getElementById('newCountry').value;
    const state = document.getElementById('newState').value;
    const km = document.getElementById('newKm').value;
    const time = document.getElementById('newTime').value;
    const desc = document.getElementById('newDesc').value;

    let coords = [51.16, 10.45]; 
    if (tempStartMarker) {
        const ll = tempStartMarker.getLatLng();
        coords = [ll.lat, ll.lng];
    }

    const newTour = { 
        title, category: region, country, state, km, time, desc, 
        user: currentUser.displayName || "Unbekannt",
        coords: coords,
        routeGeometry: window.tempRouteGeometry || null,
        // FEATURE: Initialwerte für Bewertung
        rating: 0,
        votes: 0
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
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('addTourModal'));
            modal.hide();
            e.target.reset(); 
            resetMapMarkers();
            
            filterTours(); 
            alert("Tour veröffentlicht!"); 
        }
    } catch (err) { alert("Fehler: " + err.message); }
}

function resetMapMarkers() {
    if (tempStartMarker) map.removeLayer(tempStartMarker);
    if (tempEndMarker) map.removeLayer(tempEndMarker);
    if (currentRouteLayer) map.removeLayer(currentRouteLayer);
    tempStartMarker = null; tempEndMarker = null; currentRouteLayer = null;
    window.tempRouteGeometry = null;
    
    document.getElementById('btn-pick-start').classList.remove('btn-success');
    document.getElementById('btn-pick-start').classList.add('btn-outline-danger');
    document.getElementById('btn-pick-start').innerHTML = "📍 Start wählen";
    
    document.getElementById('btn-pick-end').classList.remove('btn-success');
    document.getElementById('btn-pick-end').classList.add('btn-outline-danger');
    document.getElementById('btn-pick-end').innerHTML = "🏁 Ziel wählen";
}

function renderTours(data) {
    const listContainer = document.getElementById('tours-container');
    if(!listContainer) return;
    listContainer.innerHTML = '';
    
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (currentRouteLayer) map.removeLayer(currentRouteLayer);

    data.forEach(tour => {
        if(tour.coords) {
            const marker = L.marker(tour.coords).addTo(map);
            marker.bindPopup(`<b>${tour.title}</b><br>${tour.km} km`);
            marker.on('click', () => showTourOnMap(tour));
            markers.push(marker);
        }

        const card = document.createElement('div');
        card.className = 'mini-tour-card mb-2 p-3 border rounded shadow-sm bg-white';
        
        let actionBtn = "";

if (tour.routeGeometry) {
    actionBtn = `<button class="btn btn-sm btn-outline-success mt-2" onclick="event.stopPropagation(); downloadGPX('${tour.id}')">💾 GPX</button>`;
} else {
    // Falls keine Route da ist -> Upload Button zeigen
    // HINWEIS: Wir brauchen ein unsichtbares file input feld für den Upload
    actionBtn = `
        <label class="btn btn-sm btn-outline-warning mt-2" onclick="event.stopPropagation();">
            📂 Route hochladen
            <input type="file" style="display:none" onchange="handleGpxUpload(event, '${tour.id}')" accept=".gpx">
        </label>
    `;
}

     // --- IN renderTours(data) ---

// Helper funktion für klickbare Sterne
const generateStars = (currentRating, tourId) => {
    let html = '<div class="star-rating">';
    for (let i = 1; i <= 5; i++) {
        // Entscheiden, ob Stern voll (★) oder leer (☆)
        const char = i <= Math.round(currentRating) ? '★' : '☆';
        // Jeder Stern ruft beim Klick 'submitVote' auf
        html += `<span style="cursor:pointer; font-size:1.2rem;" 
                  onclick="event.stopPropagation(); submitVote('${tourId}', ${i})" 
                  title="${i} Sterne geben">${char}</span>`;
    }
    html += `</div>`;
    return html;
};

// ... inside the loop ...
const starHtml = generateStars(tour.rating || 0, tour.id);
// ...
        card.innerHTML = `
            <div onclick="window.showTourOnMap('${tour.id}')" style="cursor:pointer;">
                <div class="d-flex justify-content-between align-items-start">
                    <h5 class="fw-bold m-0 text-primary">${tour.title}</h5>
                    <div class="text-warning small" title="${votes} Bewertungen">${starHtml} <span class="text-muted">(${votes})</span></div>
                </div>
                <div class="small text-muted mb-2">${tour.category} • ${tour.country} • <b>${tour.km} km</b></div>
                <p class="small mb-0 text-secondary">${tour.desc || ""}</p>
            </div>
            ${gpxBtn}
        `;
        listContainer.appendChild(card);
    });
}


window.submitVote = async (tourId, rating) => {
    if (!confirm(`Möchtest du dieser Tour ${rating} Sterne geben?`)) return;

    try {
        const response = await fetch(`${API_URL}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: tourId, rating: rating })
        });

        if (response.ok) {
            const updatedTour = await response.json();
            // Lokales Array updaten, damit wir nicht neu laden müssen
            const index = toursData.findIndex(t => t.id === tourId);
            if (index !== -1) toursData[index] = updatedTour;
            
            filterTours(); // Liste neu rendern
        } else {
            alert("Fehler beim Bewerten.");
        }
    } catch (e) {
        console.error(e);
    }
};

window.showTourOnMap = (tourId) => {
    const tour = (typeof tourId === 'string') ? toursData.find(t => t.id === tourId) : tourId;
    if (!tour) return;

    if (currentRouteLayer) map.removeLayer(currentRouteLayer);

    if (tour.coords) {
        map.flyTo(tour.coords, 11);
    }

    if (tour.routeGeometry && tour.routeGeometry.length > 0) {
        currentRouteLayer = L.polyline(tour.routeGeometry, { color: 'red', weight: 5 }).addTo(map);
        map.fitBounds(currentRouteLayer.getBounds());
    }
};

window.downloadGPX = (tourId) => {
    const tour = toursData.find(t => t.id === tourId);
    if (!tour || !tour.routeGeometry) return alert("Keine Routendaten vorhanden.");

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Riderpoint App">
  <trk>
    <name>${tour.title}</name>
    <trkseg>`;
    tour.routeGeometry.forEach(pt => {
        gpx += `\n      <trkpt lat="${pt[0]}" lon="${pt[1]}"></trkpt>`;
    });
    gpx += `\n    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tour.title.replace(/\s+/g, '_')}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

window.handleGpxUpload = (event, tourId) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        
        // Simpler GPX Parser (sucht nach <trkpt>)
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const points = xmlDoc.getElementsByTagName("trkpt");
        
        let coords = [];
        for (let i = 0; i < points.length; i++) {
            const lat = parseFloat(points[i].getAttribute("lat"));
            const lon = parseFloat(points[i].getAttribute("lon"));
            coords.push([lat, lon]);
        }

        if (coords.length === 0) return alert("Keine Wegpunkte im GPX gefunden.");

        // An Backend senden
        try {
            const res = await fetch(`${API_URL}/tours/update-route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: tourId, 
                    routeGeometry: coords,
                    km: (coords.length * 0.05).toFixed(1) // Sehr grobe Schätzung, besser wäre Berechnung
                }) 
            });

            if (res.ok) {
                alert("Route erfolgreich hinzugefügt!");
                loadToursFromServer(); // Neu laden
            }
        } catch (err) {
            alert("Fehler beim Upload: " + err.message);
        }
    };
    reader.readAsText(file);
};

/* ==========================================
   HELPER FOR FORUM & OTHERS
   ========================================== */
function initFilters() {
    const catSelect = document.getElementById('filter-category');
    if(!catSelect) return;
    catSelect.innerHTML = '<option value="all">Bitte wählen...</option>';
    const cats = [...new Set(toursData.map(t => t.category))].sort();
    cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.innerText = c; catSelect.appendChild(opt); });
}
window.onCategoryChange = () => {
    const selectedCat = document.getElementById('filter-category').value;
    const countrySelect = document.getElementById('filter-country');
    countrySelect.innerHTML = '<option value="all">Alle Länder</option>';
    countrySelect.disabled = (selectedCat === 'all');
    if (!countrySelect.disabled) {
        const countries = [...new Set(toursData.filter(t => t.category === selectedCat).map(t => t.country))].sort();
        countries.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.innerText = c; countrySelect.appendChild(opt); });
    }
    window.filterTours();
};
window.onCountryChange = () => {
    const selectedCat = document.getElementById('filter-category').value;
    const selectedCountry = document.getElementById('filter-country').value;
    const stateSelect = document.getElementById('filter-state');
    stateSelect.innerHTML = '<option value="all">Alle Gebiete</option>';
    stateSelect.disabled = (selectedCountry === 'all');
    if (!stateSelect.disabled) {
        const states = [...new Set(toursData.filter(t => t.category === selectedCat && t.country === selectedCountry).map(t => t.state))].sort();
        states.forEach(s => { const opt = document.createElement('option'); opt.value = s; opt.innerText = s; stateSelect.appendChild(opt); });
    }
    window.filterTours();
};
window.filterTours = () => {
    const cat = document.getElementById('filter-category')?.value;
    const country = document.getElementById('filter-country')?.value;
    const state = document.getElementById('filter-state')?.value;
    const search = document.getElementById('search-input')?.value.toLowerCase();
    let filtered = toursData;
    if(cat && cat !== 'all') filtered = filtered.filter(t => t.category === cat);
    if(country && country !== 'all') filtered = filtered.filter(t => t.country === country);
    if(state && state !== 'all') filtered = filtered.filter(t => t.state === state);
    if(search) filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || t.desc.toLowerCase().includes(search));
    renderTours(filtered);
};
window.resetFilters = () => {
    document.getElementById('search-input').value = "";
    document.getElementById('filter-category').value = "all";
    window.onCategoryChange();
};
window.renderForumHome = function() {
    currentCategoryId = null; currentForumTopic = null;
    renderBreadcrumbs([]); 
    const container = document.getElementById('forum-container');
    container.innerHTML = `<h2 class="fw-bold mb-3">Community Übersicht</h2>
        <div class="d-none d-md-flex forum-header-row"><div style="flex-grow:1;">Forum</div><div style="width:100px; text-align:center;">Themen</div><div style="width:100px; text-align:center;">Beiträge</div><div style="width:30px;"></div></div>`;

    allForumData.forEach(cat => {
        const stats = getForumStats(t => cat.topics.map(topic => topic.title).includes(t.topic));
        const lastPostHtml = stats.lastPost ? `<div class="mt-1 small text-muted">Neuer Beitrag in <span class="fw-bold text-dark">${stats.lastPost.topic}</span> von <span class="fw-bold text-dark">${stats.lastPost.user}</span> (am ${stats.lastPost.date})</div>` : `<small class="text-muted">Keine Beiträge</small>`;
        container.innerHTML += `<div class="forum-row" style="cursor:pointer;" onclick="renderForumSubCategory('${cat.id}')"><div class="forum-icon">🏍️</div><div class="forum-main"><h5 class="fw-bold text-dark mb-0">${cat.title}</h5><p class="text-muted small mb-0">${cat.desc || ""}</p>${lastPostHtml}</div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.threadCount}</div></div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.postCount}</div></div><div class="forum-arrow">❯</div></div>`;
    });
};
window.renderForumSubCategory = function(catId) {
    currentCategoryId = catId; currentForumTopic = null;
    const category = allForumData.find(c => c.id === catId);
    if (!category) return;
    renderBreadcrumbs([{ label: category.title, onclick: null }]); 
    const container = document.getElementById('forum-container');
    const isAllowed = USER_EDITABLE_CATEGORIES.includes(catId) || currentRole === 'admin';
    container.innerHTML = `<div class="clearfix mb-3"><h2 class="fw-bold float-start">${category.title}</h2>${currentUser && isAllowed ? `<button class="btn btn-outline-dark btn-sm float-end" onclick="openAddCategoryModal('${catId}')">+ Neue Kategorie</button>` : ""}</div>
        <div class="d-none d-md-flex forum-header-row"><div style="flex-grow:1;">Thema</div><div style="width:100px; text-align:center;">Themen</div><div style="width:100px; text-align:center;">Beiträge</div><div style="width:30px;"></div></div>`;
    category.topics.forEach(topic => {
        const stats = getForumStats(t => t.topic === topic.title);
        const lastPostHtml = stats.lastPost ? `<div class="mt-1 small text-muted">Neuer Beitrag von <span class="fw-bold text-dark">${stats.lastPost.user}</span> (am ${stats.lastPost.date})</div>` : `<small class="text-muted">Leer</small>`;
        container.innerHTML += `<div class="forum-row" style="cursor:pointer;" onclick="renderForumThreads('${topic.title}', '${category.id}')"><div class="forum-icon">🔧</div><div class="forum-main"><h5 class="fw-bold text-primary mb-0">${topic.title}</h5><p class="text-muted small mb-0">${topic.desc || ""}</p>${lastPostHtml}</div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.threadCount}</div></div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.postCount}</div></div><div class="forum-arrow">❯</div></div>`;
    });
};
window.renderForumThreads = async function(topicName, catId) {
    currentForumTopic = topicName;
    const cat = allForumData.find(c => c.id === catId);
    renderBreadcrumbs([{ label: cat.title, onclick: `renderForumSubCategory('${cat.id}')` }, { label: topicName, onclick: null }]);
    const container = document.getElementById('forum-container');
    container.innerHTML = `<div class="clearfix mb-3"><h3 class="fw-bold float-start">${topicName}</h3>${currentUser ? `<button class="btn btn-danger float-end" onclick="openNewThreadModal()">Neues Thema +</button>` : ""}</div>
        <div class="forum-header-row d-flex"><div style="flex-grow:1;">Thema / Ersteller</div><div style="width:100px; text-align:center;">Antworten</div><div style="width:150px; text-align:right;">Letzter Beitrag</div></div>
        <div id="thread-list-area"><div class="text-center p-4"><div class="spinner-border text-danger"></div></div></div>`;
    const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
    const threads = await response.json();
    const listArea = document.getElementById('thread-list-area');
    listArea.innerHTML = (threads.length === 0) ? '<div class="p-4 text-center text-muted">Noch keine Themen vorhanden.</div>' : "";
    threads.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    threads.forEach(thread => {
        listArea.innerHTML += `<div class="forum-row py-2" style="cursor:pointer;" onclick="renderThreadDetail('${thread.id}', '${thread.topic}', '${catId}')"><div class="forum-icon">📄</div><div class="forum-main"><div class="fw-bold text-dark">${thread.title}</div><div class="small text-muted">von ${thread.user} • ${thread.date}</div></div><div class="forum-stats fw-bold">${thread.replies || 0}</div><div class="text-end text-muted small" style="width:150px;">${thread.date}<br>by ${thread.user}</div></div>`;
    });
};
window.renderThreadDetail = async function(threadId, topicName, catId) {
    let breadcrumbs = [];
    if (catId) {
        const cat = allForumData.find(c => c.id === catId);
        if (cat) breadcrumbs.push({ label: cat.title, onclick: `renderForumSubCategory('${cat.id}')` });
    }
    breadcrumbs.push({ label: topicName, onclick: `renderForumThreads('${topicName}', '${catId}')` }); 
    breadcrumbs.push({ label: "Beitrag lesen", onclick: null });
    renderBreadcrumbs(breadcrumbs);
    const container = document.getElementById('forum-container');
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';
    const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
    const threads = await response.json();
    const t = threads.find(thread => thread.id === threadId);
    if (!t) return;
    container.innerHTML = `<h3 class="fw-bold mb-4">${t.title}</h3>
        <div class="card mb-3 border-0 shadow-sm"><div class="card-header bg-light border-bottom py-2 d-flex justify-content-between"><div><span class="fw-bold text-danger">${t.user}</span> <span class="text-muted small">schrieb am ${t.date}:</span></div><div class="text-muted small">#1</div></div><div class="card-body"><p class="card-text fs-5" style="white-space: pre-wrap;">${t.text}</p></div></div>`;
    if (t.repliesList) {
        t.repliesList.forEach((r, idx) => {
            container.innerHTML += `<div class="card mb-3 border-0 shadow-sm ms-3 ms-md-5 bg-white"><div class="card-header bg-white border-bottom-0 py-2 d-flex justify-content-between"><div><span class="fw-bold text-dark">${r.user}</span> <span class="text-muted small">antwortete am ${r.date}:</span></div><div class="text-muted small">#${idx + 2}</div></div><div class="card-body pt-0"><p class="mb-0" style="white-space: pre-wrap;">${r.text}</p></div></div>`;
        });
    }
    if (currentUser) {
        container.innerHTML += `<div class="card mt-4 bg-light border-0"><div class="card-body"><h6 class="fw-bold mb-2">Antworten</h6><textarea id="replyText" class="form-control mb-2" rows="3"></textarea><div class="d-flex justify-content-between"><div><button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('😀', 'replyText')">😀</button><button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('👍', 'replyText')">👍</button></div><button class="btn btn-danger" onclick="sendReply('${t.id}', '${t.topic}', '${catId}')">Antworten</button></div></div></div>`;
    }
};
window.sendReply = async function(threadId, topic, catId) {
    const text = document.getElementById('replyText').value;
    if (!text.trim()) return alert("Bitte Text eingeben!");
    try {
        const response = await fetch(`${API_URL}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: threadId, topic, text, user: currentUser.displayName || "Unbekannt" })
        });
        if (response.ok) renderThreadDetail(threadId, topic, catId);
    } catch (err) { alert(err.message); }
};
async function loadForumData() {
    const container = document.getElementById('forum-container');
    if(!container) return;
    try {
        const catResponse = await fetch(`${API_URL}/forum`);
        allForumData = await catResponse.json();
        const threadResponse = await fetch(`${API_URL}/threads`); 
        if (threadResponse.ok) allThreadsCache = await threadResponse.json();
        if (!currentCategoryId && !currentForumTopic) renderForumHome();
    } catch (error) { console.error(error); }
}
function renderBreadcrumbs(pathArray) {
    let breadcrumbEl = document.getElementById('custom-breadcrumbs');
    if (!breadcrumbEl) {
        breadcrumbEl = document.createElement('div');
        breadcrumbEl.id = 'custom-breadcrumbs';
        breadcrumbEl.className = 'custom-breadcrumb container-xl';
        const forumPage = document.getElementById('page-forum');
        forumPage.insertBefore(breadcrumbEl, forumPage.firstChild);
    }
    let html = `<a onclick="navigateTo('home')">Startseite</a> <span>›</span> <a onclick="renderForumHome()">Forum</a>`;
    pathArray.forEach(item => {
        html += ` <span>›</span> `;
        html += item.onclick ? `<a onclick="${item.onclick}">${item.label}</a>` : `<span class="active">${item.label}</span>`;
    });
    breadcrumbEl.innerHTML = html;
}
function getForumStats(filterFn) {
    const threads = allThreadsCache.filter(filterFn);
    const postCount = threads.reduce((acc, t) => acc +  (t.replies || 0), 0);
    threads.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    return { threadCount: threads.length, postCount, lastPost: threads[0] || null };
}

async function handleRegister() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nickname = document.getElementById('authName').value; 
    const msg = document.getElementById('auth-message');
    if (!nickname) return msg.innerHTML = `<span class="text-danger">Nickname fehlt!</span>`;
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: nickname });
        msg.innerHTML = `<span class="text-success">Willkommen ${nickname}!</span>`;
        setTimeout(() => window.location.reload(), 1000);
    } catch (error) { msg.innerHTML = `<span class="text-danger">${error.message}</span>`; }
}
async function handleLogin(e) {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const msg = document.getElementById('auth-message');
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        bootstrap.Modal.getInstance(document.getElementById('authModal')).hide();
    } catch (error) { msg.innerHTML = `<span class="text-danger">${error.message}</span>`; }
}
window.openNewThreadModal = () => { document.getElementById('threadTopicDisplay').value = currentForumTopic; new bootstrap.Modal(document.getElementById('createThreadModal')).show(); };
window.openAddCategoryModal = (id) => { document.getElementById('mainCatIdInput').value = id; new bootstrap.Modal(document.getElementById('addCategoryModal')).show(); };
window.insertEmoji = (emoji, id = 'threadText') => { const el = document.getElementById(id); if(el) { el.value += emoji; el.focus(); } };