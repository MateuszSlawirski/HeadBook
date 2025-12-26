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

// ÄNDERN FÜR LOCALHOST:
//const API_URL = "http://localhost:7071/api"; 

// ORIGINAL (für späteres Deployment wieder zurückändern):
 const API_URL = "https://riderpoint-backend.azurewebsites.net/api";

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
        
        // Refresh bei Klick auf "Touren"
        if (pageId === 'tours') {
            if (map) {
                setTimeout(() => { 
                    map.invalidateSize(); 
                    map.setView([51.16, 10.45], 6); // Zurück zur Mitte DE
                    if (currentRouteLayer) map.removeLayer(currentRouteLayer);
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

    // Forum Listeners
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

    // Tour Listeners
    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

/* ==========================================
   TOUREN LOGIK (BAUM-STRUKTUR) & MAP
   ========================================== */

async function loadToursFromServer() {
    try {
        const response = await fetch(`${API_URL}/tours`);
        if (response.ok) {
            toursData = await response.json();
            // Sortieren: Neueste zuerst
            toursData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderTourTree();
        }
    } catch (error) { 
        console.warn("Tours offline", error); 
        const container = document.getElementById('tours-tree-container');
        if(container) container.innerHTML = '<div class="alert alert-danger m-3">Konnte Touren nicht laden.</div>';
    }
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
}

// Gruppiert die Daten und baut das Accordion
function renderTourTree() {
    const container = document.getElementById('tours-tree-container');
    if (!container) return;
    container.innerHTML = '';

    if (toursData.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted">Noch keine Touren vorhanden.</div>';
        return;
    }

    // 1. Daten gruppieren: Region -> Land -> Array von Touren
    const groups = {};
    toursData.forEach(tour => {
        const region = tour.category || "Sonstiges";
        const country = tour.country || "Unbekannt";
        
        if (!groups[region]) groups[region] = {};
        if (!groups[region][country]) groups[region][country] = [];
        
        groups[region][country].push(tour);
    });

    // 2. HTML generieren (Bootstrap Accordion)
    const accordionId = "accordionRegions";
    let html = `<div class="accordion accordion-flush" id="${accordionId}">`;

    Object.keys(groups).sort().forEach((region, index) => {
        const regionId = `heading${index}`;
        const collapseId = `collapse${index}`;
        
        // Level 1 Header (Region)
        html += `
        <div class="accordion-item bg-transparent">
            <h2 class="accordion-header" id="${regionId}">
                <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    🌍 ${region}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#${accordionId}">
                <div class="accordion-body p-0">
        `;

        // Level 2: Länder
        const countries = groups[region];
        Object.keys(countries).sort().forEach(country => {
            const tours = countries[country];
            
            // Land Header
            html += `<div class="bg-light p-2 ps-3 fw-bold text-secondary border-bottom border-top"><small>🏳️ ${country}</small></div>`;
            
            // Level 3: Die Touren Cards
            html += `<div class="list-group list-group-flush">`;
            tours.forEach(tour => {
                html += createTourListItem(tour);
            });
            html += `</div>`;
        });

        html += `
                </div>
            </div>
        </div>`;
    });

    html += `</div>`; // End Accordion
    container.innerHTML = html;
}

function createTourListItem(tour) {
    const votes = tour.votes || 0;
    const starHtml = generateStars(tour.rating || 0, tour.id);
    
    // GPX Button Logik
    let actionBtn = "";
    if (tour.routeGeometry) {
        actionBtn = `<button class="btn btn-link btn-sm text-decoration-none p-0" onclick="event.stopPropagation(); downloadGPX('${tour.id}')">💾 GPX</button>`;
    }

    return `
    <div class="list-group-item list-group-item-action p-3 border-bottom tour-item-card" id="tour-card-${tour.id}" onclick="selectTour('${tour.id}')" style="cursor:pointer;">
        <div class="d-flex justify-content-between">
            <h6 class="fw-bold mb-1 text-primary text-truncate">${tour.title}</h6>
            <small class="text-muted text-nowrap">${tour.km} km</small>
        </div>
        <div class="small text-warning mb-1">${starHtml} <span class="text-muted" style="font-size:0.75em">(${votes})</span></div>
        <p class="mb-2 text-muted small text-truncate" style="max-width: 95%;">${tour.desc || "Keine Beschreibung"}</p>
        <div class="d-flex justify-content-between align-items-center">
            <span class="badge bg-secondary fw-normal" style="font-size:0.7em">${tour.state || tour.country}</span>
            ${actionBtn}
        </div>
    </div>
    `;
}

// Wird aufgerufen, wenn man auf eine Tour in der Liste klickt
window.selectTour = (tourId) => {
    // 1. Visuell markieren
    document.querySelectorAll('.tour-item-card').forEach(el => el.classList.remove('tour-card-active'));
    const activeCard = document.getElementById(`tour-card-${tourId}`);
    if(activeCard) activeCard.classList.add('tour-card-active');

    // 2. Auf Karte anzeigen
    showTourOnMap(tourId);
    
    // 3. Auf Mobile: Automatisch zur Karte scrollen
    if(window.innerWidth < 768) {
        document.getElementById('map').scrollIntoView({behavior: 'smooth'});
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

/* ==========================================
   GPX UPLOAD LOGIK
   ========================================== */

// Globale Variable, um die geparste Route zwischenzuspeichern
let tempGpxData = null;

// 1. Die Funktion, die aufgerufen wird, wenn eine Datei gewählt wird
window.handleGpxFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        parseAndPreviewGpx(text);
    };
    reader.readAsText(file);
};

// 2. GPX Parsen, Werte berechnen und Vorschau auf Karte
function parseAndPreviewGpx(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    const trkpts = xmlDoc.getElementsByTagName("trkpt");

    if (trkpts.length === 0) {
        alert("Fehler: Keine Wegpunkte in dieser GPX gefunden.");
        return;
    }

    let coordinates = [];
    let totalDist = 0;

    // Koordinaten extrahieren & Distanz berechnen
    for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute("lat"));
        const lon = parseFloat(trkpts[i].getAttribute("lon"));
        coordinates.push([lat, lon]);

        if (i > 0) {
            const prev = coordinates[i - 1];
            totalDist += getDistanceFromLatLonInKm(prev[0], prev[1], lat, lon);
        }
    }

    // Werte runden
    const km = totalDist.toFixed(1);
    const hours = Math.floor(km / 60);
    const minutes = Math.round((km % 60)); 
    
    // Formular füllen
    document.getElementById('newKm').value = km;
    document.getElementById('newTime').value = `${hours}h ${minutes}min`; 
    document.getElementById('btn-publish-tour').disabled = false;

    // Temporär speichern für den Upload
    tempGpxData = {
        routeGeometry: coordinates,
        coords: coordinates[0], 
        km: km
    };

    console.log("GPX geladen:", km, "km");
}

// Hilfsfunktion: Distanz berechnen
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat1)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// 3. Das eigentliche Speichern
async function handleAddTour(e) {
    e.preventDefault();
    if (!currentUser) return alert("Bitte einloggen.");
    if (!tempGpxData) return alert("Bitte erst eine GPX Datei wählen.");

    const title = document.getElementById('newTitle').value;
    const region = document.getElementById('newRegion').value;
    const country = document.getElementById('newCountry').value;
    const state = document.getElementById('newState').value;
    const desc = document.getElementById('newDesc').value;
    const time = document.getElementById('newTime').value;

    const newTour = {
        title,
        category: region,
        country,
        state,
        desc,
        time,
        km: tempGpxData.km, 
        coords: tempGpxData.coords, 
        routeGeometry: tempGpxData.routeGeometry, 
        user: currentUser.displayName || "Unbekannt",
        createdAt: new Date().toISOString(),
        rating: 0,
        votes: 0
    };

    try {
        const response = await fetch(API_URL + '/tours', { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify(newTour) 
        });

        if (response.ok) {
            const savedTour = await response.json();
            // In die Liste einsortieren (reload reicht hier, oder manuell einfügen)
            toursData.push(savedTour); 
            toursData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderTourTree();
            
            // UI Reset
            bootstrap.Modal.getInstance(document.getElementById('addTourModal')).hide();
            e.target.reset();
            tempGpxData = null;
            document.getElementById('btn-publish-tour').disabled = true;

            showTourOnMap(savedTour);
            alert("Tour erfolgreich hochgeladen!");
        }
    } catch (err) {
        alert("Fehler beim Speichern: " + err.message);
    }
}

/* ==========================================
   HELPER FUNKTIONEN (Sterne, Downloads)
   ========================================== */

const generateStars = (currentRating, tourId) => {
    let html = '<div class="star-rating">';
    for (let i = 1; i <= 5; i++) {
        const char = i <= Math.round(currentRating) ? '★' : '☆';
        html += `<span style="cursor:pointer; font-size:1.2rem;" 
                  onclick="event.stopPropagation(); submitVote('${tourId}', ${i})" 
                  title="${i} Sterne geben">${char}</span>`;
    }
    html += `</div>`;
    return html;
};

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
            const index = toursData.findIndex(t => t.id === tourId);
            if (index !== -1) toursData[index] = updatedTour;
            renderTourTree(); 
        } else {
            alert("Fehler beim Bewerten.");
        }
    } catch (e) {
        console.error(e);
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

/* ==========================================
   FORUM LOGIK
   ========================================== */

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


// POST ERSTELLEN
window.createPost = async () => {
    // 1. Prüfen: Ist der User eingeloggt?
    if (!auth.currentUser) {
        alert("Bitte melde dich erst an, um zu posten!");
        return;
    }

    const textInput = document.getElementById('postInputText');
    const fileInput = document.getElementById('postInputFile');
    const submitBtn = document.querySelector('button[onclick="window.createPost()"]');

    // Nichts eingegeben? Abbrechen.
    if (!textInput.value.trim() && fileInput.files.length === 0) {
        alert("Bitte schreibe etwas oder wähle ein Bild aus.");
        return;
    }

    // Button deaktivieren (Lade-Status)
    const oldText = submitBtn.innerText;
    submitBtn.innerText = "Sende...";
    submitBtn.disabled = true;

    try {
        // 2. Daten für den Versand vorbereiten (FormData)
        const formData = new FormData();
        formData.append('content', textInput.value);
        
        // Wenn eine Datei gewählt wurde, hinzufügen
        if (fileInput.files.length > 0) {
            formData.append('media', fileInput.files[0]);
        }

        // 3. An deine Azure Function senden
        // HINWEIS: '/api/createPost' muss exakt so heißen wie deine Datei im 'functions' Ordner
        const response = await fetch('/api/createPost', {
            method: 'POST',
            headers: {
                // Wir schicken die User-ID im Header mit, damit das Backend weiß, wer postet
                'x-user-id': auth.currentUser.uid 
            },
            body: formData 
            // Wichtig: Bei FormData setzt der Browser den Content-Type automatisch!
        });

        if (response.ok) {
            // Erfolg!
            alert("Beitrag veröffentlicht!");
            textInput.value = "";     // Feld leeren
            fileInput.value = "";     // Datei leeren
            
            // Hier rufen wir gleich die Lade-Funktion auf (machen wir im nächsten Schritt)
            // if(window.loadFeed) window.loadFeed(); 
        } else {
            const errorMsg = await response.text();
            console.error("Server Fehler:", errorMsg);
            alert("Fehler beim Posten. Schau in die Konsole (F12).");
        }

    } catch (error) {
        console.error("Netzwerkfehler:", error);
        alert("Server nicht erreichbar. Läuft deine API?");
    } finally {
        // Button wieder normal machen
        submitBtn.innerText = oldText;
        submitBtn.disabled = false;
    }
};