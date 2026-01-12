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

// NEU: Imports für den Chat (Datenbank)
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    onSnapshot, 
    orderBy,
    getDocs,
    limit,
    doc,        
    getDoc,     
    setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const API_URL = "https://riderpoint-backend.azurewebsites.net/api";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app); // Die Chat-Datenbank starten

// STATE VARIABLES
let allPostsCache = []; 
let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let viewingUserProfile = null; 

// MAP STATE
let map = null;
let currentRouteLayer = null; 

// FORUM STATE
let currentForumTopic = null; 
let currentCategoryId = null; 
let allForumData = []; 
let allThreadsCache = []; 

const USER_EDITABLE_CATEGORIES = ["bikes", "garage", "tours"];


/* ==========================================
   APP START (Ersetzen)
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // Auth Listener
    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        
        if (user) {
            updateUI(); 
            // 1. Erst User-Rolle und Freunde vom Server holen
            await syncUserWithBackend(user); 
            
            // 2. JETZT erst Feed laden (damit Admin-Buttons da sind)
            if (getActivePage() === 'home') {
                loadFeed();
            }

            // 3. Profil laden falls wir dort sind
            if (getActivePage() === 'profile') {
                viewingUserProfile = null; 
                renderProfilePage();
            }
        } else {
            // Wenn ausgeloggt -> Gastmodus
            currentRole = "guest";
            if (getActivePage() === 'home') loadFeed();
            if (getActivePage() === 'profile') navigateTo('home');
            updateUI();
        }
    });

    loadToursFromServer();
    loadForumData(); 
    
    
    setupEventListeners();
    
    const startPage = window.location.hash.replace('#', '') || 'home';
    // Nur navigieren wenn noch kein Auth-Event gefeuert hat (vermeidet doppeltes Laden)
    if (!currentUser) navigateTo(startPage);
});

/* ==========================================
   NAVIGATION (FIX: Erst laden, dann zeigen)
   ========================================== */
async function navigateTo(pageId) {
    // 1. UI vorbereiten (Nav-Leiste aktiv setzen)
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const navLink = document.getElementById(`nav-${pageId}`);
    if(navLink) navLink.classList.add('active');

    // 2. Seite wechseln (Visuell)
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) {
        target.classList.add('active');
        window.location.hash = pageId;
    }

    // 3. SPEZIAL-LOGIK PRO SEITE
    
    // A) PROFIL: Hier war das Problem!
    if (pageId === 'profile') {
        const container = document.getElementById('page-profile');
        
        // Wenn ich mein eigenes Profil ansehe (oder noch keins gesetzt ist)
        if (!viewingUserProfile || (currentUser && viewingUserProfile.uid === currentUser.uid)) {
            
            // Lade-Animation anzeigen, damit du nicht "0 Freunde" siehst
            if(container) container.innerHTML = '<div class="text-center p-5 mt-5"><div class="spinner-border text-primary"></div><div class="mt-2">Lade Profil & Freunde...</div></div>';
            
            if(auth.currentUser) {
                // WARTEN bis Sync fertig ist
                await syncUserWithBackend(auth.currentUser);
                // Reset auf "Ich" mit den frischen Daten
                viewingUserProfile = null; 
            }
        }
        // Jetzt erst rendern (mit den frischen Daten)
        renderProfilePage();
    }

    // B) HOME: Feed aktualisieren
    if (pageId === 'home') {
        await loadFeed(); 
    }

    // C) TOUREN
    if (pageId === 'tours') {
        loadToursFromServer();
        if (map) {
            setTimeout(() => { 
                map.invalidateSize(); 
                map.setView([51.16, 10.45], 6); 
                if (currentRouteLayer) map.removeLayer(currentRouteLayer);
            }, 200);
        }
    }

    // D) FORUM
    if (pageId === 'forum') {
        renderForumHome();
    }
    // E) NOTIFICATIONS
    if (pageId === 'notifications') {
        renderNotifications();
    }
}
window.navigateTo = navigateTo;

/* ==========================================
   HELPER FUNKTIONEN 
   ========================================== */

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}

window.openMyProfile = () => {
    viewingUserProfile = null; 
    navigateTo('profile');
};

/* ==========================================
   AUTH & UI
   ========================================== */

async function syncUserWithBackend(firebaseUser) {
    if (!firebaseUser) return; 
    
    try {
        console.log("Synchronisiere User mit Backend..."); // Log für Debugging
        const response = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                uid: firebaseUser.uid, 
                email: firebaseUser.email,
                displayName: firebaseUser.displayName 
            })
        });

        if(response.ok) {
            const dbUser = await response.json();
            try {
                    if (dbUser.photoUrl) {
                        const userRef = doc(db, "users", firebaseUser.uid);
                        // Wir nutzen setDoc mit merge, das repariert/erstellt den Eintrag lautlos
                        await setDoc(userRef, {
                            photoUrl: dbUser.photoUrl,
                            displayName: dbUser.displayName || firebaseUser.displayName
                        }, { merge: true });
                    }
                } catch(e) { console.log("Auto-Sync Info:", e); }
            console.log("Daten vom Server erhalten:", dbUser); // Log der Server-Antwort

            if (currentUser) {
                currentUser.role = dbUser.role || "user";
                currentUser.bio = dbUser.bio || "";
                currentUser.photoUrl = dbUser.photoUrl || null;
                // WICHTIG: Sicherstellen, dass friends übernommen wird!
                currentUser.friends = Array.isArray(dbUser.friends) ? dbUser.friends : [];
                currentRole = currentUser.role;
            }
            
            updateUI(); 
            // Falls wir gerade auf dem Profil sind, sofort aktualisieren
            if (getActivePage() === 'profile') renderProfilePage();
        } else {
            console.error("Server Fehler beim Sync:", await response.text());
        }
    } catch (err) {
        console.warn("Backend Sync Fehler (Netzwerk?):", err);
    }
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
        new bootstrap.Modal(document.getElementById('authModal')).show();
        const msg = document.getElementById('auth-message');
        if(msg) msg.innerHTML = '<span class="text-danger fw-bold">Bitte erst einloggen!</span>';
    } else {
        new bootstrap.Modal(document.getElementById('addTourModal')).show();
    }
};

/* ==========================================
   EVENT LISTENERS
   ========================================== */

function setupEventListeners() {
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) btnLogout.addEventListener('click', async () => { 
        await signOut(auth); 
        window.showToast("Erfolgreich ausgeloggt."); 
        navigateTo('home'); 
    });

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
            if (!currentUser) return window.showToast("Bitte logge dich erst ein!", true);
            const title = document.getElementById('threadTitle').value;
            const text = document.getElementById('threadText').value;
            try {
                const response = await fetch(`${API_URL}/createThread`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: currentForumTopic, title, text, user: currentUser.displayName || "Unbekannt" })
                });
                if (response.ok) {
                    bootstrap.Modal.getInstance(document.getElementById('createThreadModal')).hide();
                    e.target.reset();
                    await loadForumData(); 
                    await renderForumThreads(currentForumTopic, currentCategoryId); 
                    window.showToast("Thema erstellt!");
                }
            } catch (err) { window.showToast("Fehler: " + err.message, true); }
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
                const response = await fetch(`${API_URL}/addCategory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mainCatId, title, desc })
                });
                if (response.ok) {
                    bootstrap.Modal.getInstance(document.getElementById('addCategoryModal')).hide();
                    e.target.reset();
                    await loadForumData();
                    renderForumSubCategory(mainCatId);
                    window.showToast("Kategorie angelegt.");
                }
            } catch (err) { window.showToast("Fehler: " + err.message, true); }
        });
    }

    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

/* ==========================================
   TOUREN & MAP
   ========================================== */

async function loadToursFromServer() {
    try {
        const response = await fetch(`${API_URL}/GetTours`);
        if (response.ok) {
            toursData = await response.json();
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
        maxZoom: 19, attribution: '© OpenStreetMap contributors' 
    }).addTo(map);
}

function renderTourTree() {
    const container = document.getElementById('tours-tree-container');
    if (!container) return;
    container.innerHTML = '';

    if (toursData.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted">Noch keine Touren vorhanden.</div>';
        return;
    }

    const groups = {};
    toursData.forEach(tour => {
        const region = tour.category || "Sonstiges";
        const country = tour.country || "Unbekannt";
        if (!groups[region]) groups[region] = {};
        if (!groups[region][country]) groups[region][country] = [];
        groups[region][country].push(tour);
    });

    const accordionId = "accordionRegions";
    let html = `<div class="accordion accordion-flush" id="${accordionId}">`;

    Object.keys(groups).sort().forEach((region, index) => {
        const regionId = `heading${index}`;
        const collapseId = `collapse${index}`;
        
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

        const countries = groups[region];
        Object.keys(countries).sort().forEach(country => {
            const tours = countries[country];
            html += `<div class="bg-light p-2 ps-3 fw-bold text-secondary border-bottom border-top"><small>🏳️ ${country}</small></div>`;
            html += `<div class="list-group list-group-flush">`;
            tours.forEach(tour => {
                html += createTourListItem(tour);
            });
            html += `</div>`;
        });
        html += `</div></div></div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}

function createTourListItem(tour) {
    let actionBtn = "";
    if (tour.routeGeometry) {
        actionBtn = `<button class="btn btn-link btn-sm text-decoration-none p-0" onclick="event.stopPropagation(); downloadGPX('${tour.id}')">💾 GPX</button>`;
    }
    const deleteBtn = getDeleteBtn('tour', tour.id, tour.id);
    const buttonsHtml = actionBtn + deleteBtn;

    return `
    <div class="list-group-item list-group-item-action p-3 border-bottom tour-item-card" id="tour-card-${tour.id}" onclick="selectTour('${tour.id}')" style="cursor:pointer;">
        <div class="d-flex justify-content-between">
            <h6 class="fw-bold mb-1 text-primary text-truncate">${tour.title}</h6>
            <small class="text-muted text-nowrap">${tour.km} km</small>
        </div>
        <p class="mb-2 text-muted small text-truncate" style="max-width: 95%;">${tour.desc || "Keine Beschreibung"}</p>
        <div class="d-flex justify-content-between align-items-center">
            <div>
                <span class="badge bg-secondary fw-normal me-2" style="font-size:0.7em">${tour.state || tour.country}</span>
                <small class="text-muted" style="font-size:0.8em">von 
                    <b style="cursor:pointer" class="text-primary" onclick="event.stopPropagation(); openUserProfile('${tour.userId}', '${tour.user}')">
                        ${tour.user || "Unbekannt"}
                    </b>
                </small>
            </div>
            <div>${buttonsHtml}</div>
        </div>
    </div>`;
}

window.selectTour = (tourId) => {
    document.querySelectorAll('.tour-item-card').forEach(el => el.classList.remove('tour-card-active'));
    const activeCard = document.getElementById(`tour-card-${tourId}`);
    if(activeCard) activeCard.classList.add('tour-card-active');
    showTourOnMap(tourId);
    if(window.innerWidth < 768) {
        document.getElementById('map').scrollIntoView({behavior: 'smooth'});
    }
};

window.showTourOnMap = (tourId) => {
    const tour = (typeof tourId === 'string') ? toursData.find(t => t.id === tourId) : tourId;
    if (!tour) return;
    if (currentRouteLayer) map.removeLayer(currentRouteLayer);
    if (tour.coords) map.flyTo(tour.coords, 11);
    if (tour.routeGeometry && tour.routeGeometry.length > 0) {
        currentRouteLayer = L.polyline(tour.routeGeometry, { color: 'red', weight: 5 }).addTo(map);
        map.fitBounds(currentRouteLayer.getBounds());
    }
};

/* ==========================================
   GPX UPLOAD
   ========================================== */
let tempGpxData = null;

window.handleGpxFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => parseAndPreviewGpx(e.target.result);
    reader.readAsText(file);
};

function parseAndPreviewGpx(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    const trkpts = xmlDoc.getElementsByTagName("trkpt");
    if (trkpts.length === 0) return window.showToast("Fehler: Keine Wegpunkte in GPX.", true);

    let coordinates = [];
    let totalDist = 0;
    for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute("lat"));
        const lon = parseFloat(trkpts[i].getAttribute("lon"));
        coordinates.push([lat, lon]);
        if (i > 0) {
            const prev = coordinates[i - 1];
            totalDist += getDistanceFromLatLonInKm(prev[0], prev[1], lat, lon);
        }
    }
    const km = totalDist.toFixed(1);
    const hours = Math.floor(km / 60);
    const minutes = Math.round((km % 60)); 
    
    document.getElementById('newKm').value = km;
    document.getElementById('newTime').value = `${hours}h ${minutes}min`; 
    document.getElementById('btn-publish-tour').disabled = false;

    tempGpxData = { routeGeometry: coordinates, coords: coordinates[0], km: km };
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat1)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function deg2rad(deg) { return deg * (Math.PI / 180); }

async function handleAddTour(e) {
    e.preventDefault();
    if (!currentUser) return window.showToast("Bitte einloggen.", true);
    if (!tempGpxData) return window.showToast("Bitte erst eine GPX Datei wählen.", true);

    const newTour = {
        title: document.getElementById('newTitle').value,
        category: document.getElementById('newRegion').value,
        country: document.getElementById('newCountry').value,
        state: document.getElementById('newState').value,
        desc: document.getElementById('newDesc').value,
        time: document.getElementById('newTime').value,
        km: tempGpxData.km, 
        coords: tempGpxData.coords, 
        routeGeometry: tempGpxData.routeGeometry, 
        user: currentUser.displayName || "Unbekannt",
        createdAt: new Date().toISOString(),
    };

    try {
        const response = await fetch(API_URL + '/addTour', { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify(newTour) 
        });
        if (response.ok) {
            const savedTour = await response.json();
            toursData.push(savedTour); 
            toursData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderTourTree();
            bootstrap.Modal.getInstance(document.getElementById('addTourModal')).hide();
            e.target.reset();
            tempGpxData = null;
            document.getElementById('btn-publish-tour').disabled = true;
            showTourOnMap(savedTour);
            window.showToast("Tour erfolgreich hochgeladen!");
        }
    } catch (err) { window.showToast("Fehler beim Speichern: " + err.message, true); }
}

/* ==========================================
   LÖSCH-FUNKTION
   ========================================== */
window.deleteItem = async (type, id, partitionKey, parentId = null, commentText = null, commentUser = null) => {
    if (!confirm("Wirklich unwiderruflich löschen?")) return;

    const payload = { type, id, partitionKey, parentId, commentText, commentUser };
    
    try {
        const response = await fetch(`${API_URL}/deleteItem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            window.showToast("Gelöscht!");
            if (type === 'tour') { loadToursFromServer(); }
            else if (type === 'post' || type === 'comment') { window.loadFeed(); }
            else if (type === 'thread' || type === 'reply') { 
                if(type==='thread') renderForumSubCategory(currentCategoryId); 
                else renderThreadDetail(parentId, currentForumTopic, currentCategoryId);
            }
            else if (type === 'topic') { 
                renderForumSubCategory(currentCategoryId);
            }
        } else {
            const err = await response.text();
            window.showToast(`Fehler beim Löschen (${response.status}):\n${err}`, true);
        }
    } catch (e) { console.error(e); window.showToast("Server Fehler", true); }
};

function getDeleteBtn(type, id, partitionKey, parentId=null, text=null, user=null) {
    if (currentRole !== 'admin') return "";

    const formatArg = (val) => {
        if (val === null || val === undefined) return 'null';
        return `'${val.toString().replace(/'/g, "\\'").replace(/\n/g, " ")}'`;
    };

    return `<button class="btn btn-sm btn-outline-danger border-0 ms-2" 
            onclick="event.stopPropagation(); deleteItem('${type}', ${formatArg(id)}, ${formatArg(partitionKey)}, ${formatArg(parentId)}, ${formatArg(text)}, ${formatArg(user)})">
            🗑️</button>`;
}

window.downloadGPX = (tourId) => {
    const tour = toursData.find(t => t.id === tourId);
    if (!tour || !tour.routeGeometry) return window.showToast("Keine Routendaten.", true);
    let gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Riderpoint"><trk><name>${tour.title}</name><trkseg>`;
    tour.routeGeometry.forEach(pt => { gpx += `\n<trkpt lat="${pt[0]}" lon="${pt[1]}"></trkpt>`; });
    gpx += `\n</trkseg></trk></gpx>`;
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${tour.title}.gpx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
        const lastPostHtml = stats.lastPost ? `<div class="mt-1 small text-muted">Neuer Beitrag in <span class="fw-bold text-dark">${stats.lastPost.topic}</span> von <span class="fw-bold text-dark">${stats.lastPost.user}</span></div>` : `<small class="text-muted">Keine Beiträge</small>`;
        container.innerHTML += `<div class="forum-row" style="cursor:pointer;" onclick="renderForumSubCategory('${cat.id}')"><div class="forum-icon">🏍️</div><div class="forum-main"><h5 class="fw-bold text-dark mb-0">${cat.title}</h5><p class="text-muted small mb-0">${cat.desc || ""}</p>${lastPostHtml}</div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.threadCount}</div></div><div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.postCount}</div></div><div class="forum-arrow">❯</div></div>`;
    });
};

window.renderForumSubCategory = function(catId) {
    currentCategoryId = catId; currentForumTopic = null;
    const category = allForumData.find(c => c.id === catId);
    if (!category) return;
    
    renderBreadcrumbs([{ label: category.title, onclick: null }]); 
    const container = document.getElementById('forum-container');
    const showAddBtn = (currentUser && (USER_EDITABLE_CATEGORIES.includes(catId) || currentRole === 'admin'));
    
    container.innerHTML = `
        <div class="clearfix mb-3">
            <h2 class="fw-bold float-start">${category.title}</h2>
            ${showAddBtn ? `<button class="btn btn-outline-dark btn-sm float-end" onclick="openAddCategoryModal('${catId}')">+ Neue Kategorie</button>` : ""}
        </div>
        <div class="d-none d-md-flex forum-header-row"><div style="flex-grow:1;">Thema</div><div style="width:100px; text-align:center;">Themen</div><div style="width:100px; text-align:center;">Beiträge</div><div style="width:30px;"></div></div>`;
    
    category.topics.forEach(topic => {
        const stats = getForumStats(t => t.topic === topic.title);
        const safeId = topic.id || topic.rowKey || topic.title;
        let deleteBtn = "";
        if (currentRole === 'admin') {
             deleteBtn = getDeleteBtn('topic', safeId, catId, null, topic.title);
        }

        const lastPostHtml = stats.lastPost ? `<div class="mt-1 small text-muted">Neuer Beitrag von <span class="fw-bold text-dark">${stats.lastPost.user}</span></div>` : `<small class="text-muted">Leer</small>`;
        
        container.innerHTML += `
        <div class="forum-row">
            <div class="forum-icon">🔧</div>
            <div class="forum-main" style="cursor:pointer;" onclick="renderForumThreads('${topic.title}', '${category.id}')">
                <h5 class="fw-bold text-primary mb-0">${topic.title}</h5>
                <p class="text-muted small mb-0">${topic.desc || ""}</p>
                ${lastPostHtml}
            </div>
            <div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.threadCount}</div></div>
            <div class="forum-stats d-none d-md-block"><div class="fw-bold">${stats.postCount}</div></div>
            <div class="d-flex align-items-center justify-content-end" style="min-width: 40px;">
                ${deleteBtn}
                <div class="forum-arrow ms-2">❯</div>
            </div>
        </div>`;
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
    
    const response = await fetch(`${API_URL}/getThreads?topic=${encodeURIComponent(topicName)}`);
    const threads = await response.json();
    const listArea = document.getElementById('thread-list-area');
    listArea.innerHTML = (threads.length === 0) ? '<div class="p-4 text-center text-muted">Noch keine Themen vorhanden.</div>' : "";
    threads.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    threads.forEach(thread => {
        const deleteBtn = getDeleteBtn('thread', thread.id, thread.topic);

        listArea.innerHTML += `
        <div class="forum-row py-2" style="cursor:pointer;" onclick="renderThreadDetail('${thread.id}', '${thread.topic}', '${catId}')">
            <div class="forum-icon">📄</div>
            <div class="forum-main">
                <div class="fw-bold text-dark">${thread.title}</div>
                <div class="small text-muted">
                von <span class="text-primary fw-bold" style="cursor:pointer" onclick="event.stopPropagation(); openUserProfile(null, '${thread.user}')">${thread.user}</span> 
                • ${thread.date}
                </div>
            </div>
            <div class="forum-stats fw-bold d-none d-md-block">${thread.replies || 0}</div>
            <div class="text-end text-muted small" style="min-width:100px;">
                ${thread.date}
                ${deleteBtn} </div>
        </div>`;
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
    
    const response = await fetch(`${API_URL}/getThreads?topic=${encodeURIComponent(topicName)}`);
    const threads = await response.json();
    
    const t = threads.find(thread => thread.id === threadId);
    if (!t) return;

    const deleteThreadBtn = getDeleteBtn('thread', t.id, t.topic);

    // --- DETAIL VIEW RENDERN ---
    let html = `
        <h3 class="fw-bold mb-4">${t.title}</h3>
        <div class="card mb-3 border-0 shadow-sm">
            <div class="card-header bg-light border-bottom py-2 d-flex justify-content-between align-items-center">
                <div>
                    <span class="fw-bold text-danger">${t.user}</span> 
                    <span class="text-muted small">schrieb am ${t.date}:</span>
                </div>
                <div class="d-flex align-items-center">
                    <span class="text-muted small me-2">#1</span>
                    ${deleteThreadBtn} </div>
            </div>
            <div class="card-body">
                <p class="card-text fs-5" style="white-space: pre-wrap;">${t.text}</p>
            </div>
        </div>`;

    if (t.repliesList) {
        t.repliesList.forEach((r, idx) => {
            const deleteReplyBtn = getDeleteBtn('reply', null, t.topic, t.id, r.text, r.user);
            html += `
            <div class="card mb-3 border-0 shadow-sm ms-3 ms-md-5 bg-white">
                <div class="card-header bg-white border-bottom-0 py-2 d-flex justify-content-between align-items-center">
                    <div>
                        <span class="fw-bold text-dark">${r.user}</span> 
                        <span class="text-muted small">antwortete am ${r.date}:</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <span class="text-muted small me-2">#${idx + 2}</span>
                        ${deleteReplyBtn} </div>
                </div>
                <div class="card-body pt-0">
                    <p class="mb-0" style="white-space: pre-wrap;">${r.text}</p>
                </div>
            </div>`;
        });
    }

    // --- ANTWORT-FELD (WAR VORHER FEHLEND) ---
    html += `
    <div class="card mt-4 shadow-sm border-0">
        <div class="card-body">
            <h5 class="card-title">Antworten</h5>
            <textarea class="form-control mb-3" id="replyText" rows="3" placeholder="Deine Antwort..."></textarea>
            <button class="btn btn-primary" onclick="sendReply('${t.id}', '${t.topic}', '${catId}')">Absenden</button>
        </div>
    </div>`;

    container.innerHTML = html;
};   

window.sendReply = async function(threadId, topic, catId) {
    const text = document.getElementById('replyText').value;
    if (!text.trim()) return window.showToast("Bitte Text eingeben!", true);
    try {
        const response = await fetch(`${API_URL}/addReply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: threadId, topic, text, user: currentUser.displayName || "Unbekannt" })
        });
        if (response.ok) renderThreadDetail(threadId, topic, catId);
    } catch (err) { window.showToast(err.message, true); }
};

// --- HELPER: THREAD ÖFFNEN VOM PROFIL AUS ---
window.openThreadFromProfile = async (threadId, topic) => {
    navigateTo('forum');
    let catId = null;
    if(allForumData.length === 0) {
        try {
            const res = await fetch(`${API_URL}/forum`);
            allForumData = await res.json();
        } catch(e){}
    }
    
    // Wir suchen die Kategorie, zu der das Topic gehört
    for(const cat of allForumData) {
        if(cat.topics.some(t => t.title === topic)) {
            catId = cat.id;
            break;
        }
    }
    renderThreadDetail(threadId, topic, catId);
};

async function loadForumData() {
    try {
        const catResponse = await fetch(`${API_URL}/forum`);
        allForumData = await catResponse.json();
        const threadResponse = await fetch(`${API_URL}/getThreads`); 
        if (threadResponse.ok) allThreadsCache = await threadResponse.json();
        if (!currentCategoryId && !currentForumTopic && getActivePage() === 'forum') renderForumHome();
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

window.createPost = async () => {
    if (!auth.currentUser) { return window.showToast("Bitte erst anmelden!", true); }
    const textInput = document.getElementById('postInputText');
    const fileInput = document.getElementById('postInputFile');
    const submitBtn = document.querySelector('button[onclick="window.createPost()"]');

    if (!textInput.value.trim() && fileInput.files.length === 0) { return window.showToast("Bitte schreibe etwas.", true); }

    const oldText = submitBtn.innerText;
    submitBtn.innerText = "Sende...";
    submitBtn.disabled = true;

    try {
        const formData = new FormData();
        const myName = auth.currentUser.displayName || "Unbekannter Biker";
        formData.append('username', myName);
        formData.append('content', textInput.value);
        if (fileInput.files.length > 0) { formData.append('media', fileInput.files[0]); }

        const response = await fetch(`${API_URL}/createPost`, {
            method: 'POST',
            headers: { 'x-user-id': auth.currentUser.uid },
            body: formData 
        });

        if (response.ok) {
            const postData = await response.json(); 
            if(postData && postData.id) {
                allPostsCache.unshift(postData);
                loadFeed(); 
            } else {
                loadFeed();
            }
            window.showToast("Beitrag veröffentlicht!");
            textInput.value = ""; fileInput.value = "";
        } else {
            console.error("Server Fehler:", await response.text());
        }
    } catch (error) { console.error("Netzwerkfehler:", error); } 
    finally { submitBtn.innerText = oldText; submitBtn.disabled = false; }
};

/* ==========================================
   FEED / POSTS Mit Datenbank-Bildern 
   ========================================== */
window.loadFeed = async function() {
    const container = document.getElementById('feed-posts');
    if (!container) return; 

    // Lade-Animation nur beim ersten Start
    if(allPostsCache.length === 0) {
        container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';
    }

    try {
        const response = await fetch(`${API_URL}/getPosts`);
        if (!response.ok) throw new Error("Fehler beim Laden");

        const posts = await response.json();
        allPostsCache = posts;
        container.innerHTML = ""; 

        if (posts.length === 0) {
            container.innerHTML = '<div class="text-center p-4 text-muted">Noch keine Beiträge.</div>';
            return;
        }

        posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        posts.forEach(post => {
            const postId = post.id || post._id || post.rowKey; 
            const likes = Array.isArray(post.likes) ? post.likes : [];
            const comments = Array.isArray(post.comments) ? post.comments : [];
            const myUid = auth.currentUser ? auth.currentUser.uid : null;
            const isLiked = myUid && likes.includes(myUid);
            const likeClass = isLiked ? 'liked' : '';
            
            // Standard-Avatar (Initialen)
            let avatarUrl = `https://ui-avatars.com/api/?name=${post.user}&background=random&color=fff&size=128`;
            
            // Wenn ich es bin -> Mein Bild sofort nehmen (ist im Cache)
            if (currentUser && post.userId === currentUser.uid && currentUser.photoUrl) {
                avatarUrl = currentUser.photoUrl;
            }

            // Medien Inhalt
            let mediaHtml = "";
            if (post.mediaUrl) {
                if (post.mediaType === 'video') mediaHtml = `<video src="${post.mediaUrl}" controls class="img-fluid rounded mt-2 w-100" style="max-height:500px;"></video>`;
                else mediaHtml = `<img src="${post.mediaUrl}" class="img-fluid rounded mt-2 w-100" style="max-height:500px; object-fit:cover;" loading="lazy">`;
            }

            // Kommentare
            let commentsHtml = '';
            comments.forEach(c => {
                commentsHtml += `<div class="comment-item"><div class="comment-bubble"><span class="comment-author">${c.user}</span>${c.text}</div></div>`;
            });

            // --- HTML GENERIEREN ---
            // WICHTIG: Wir geben dem Bild die Klasse 'feed-avatar' und speichern die userId im 'data-userid' Attribut
            const html = `
            <div class="card mb-4 border-0 shadow-sm" id="post-${postId}">
                <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center pt-3">
                    <div class="d-flex align-items-center">
                        
                        <img src="${avatarUrl}" 
                             class="rounded-circle border me-2 feed-avatar" 
                             data-userid="${post.userId}"
                             style="width:40px; height:40px; object-fit:cover; cursor:pointer;" 
                             onclick="openUserProfile('${post.userId}', '${post.user}')">

                        <div>
                            <div class="fw-bold text-dark" style="cursor:pointer;" onclick="openUserProfile('${post.userId}', '${post.user}')">
                            ${post.user || "Unbekannt"}
                            </div>
                            <small class="text-muted">${new Date(post.createdAt).toLocaleDateString()}</small>
                        </div>
                    </div>
                    ${getDeleteBtn('post', postId, post.userId)}
                </div>
                
                <div class="card-body pt-1">
                    <p class="card-text fs-5 mb-2">${post.content}</p>
                    ${mediaHtml}
                    <div class="d-flex justify-content-between text-muted small mt-3">
                        <span id="like-count-${postId}">❤️ ${likes.length} Likes</span>
                        <span style="cursor:pointer" onclick="document.getElementById('comments-${postId}').classList.toggle('show')">${comments.length} Kommentare</span>
                    </div>
                    <div class="post-actions">
                        <button class="action-btn ${likeClass}" id="btn-like-${postId}" onclick="window.toggleLike('${postId}')">Gefällt mir</button>
                        <button class="action-btn" onclick="document.getElementById('comments-${postId}').classList.toggle('show')">Kommentieren</button>
                    </div>
                    <div id="comments-${postId}" class="comment-section">
                        <div id="comment-list-${postId}">${commentsHtml}</div>
                        <div class="comment-input-wrapper">
                            <input type="text" id="input-comment-${postId}" class="form-control form-control-sm border-0" placeholder="Kommentar...">
                            <button class="btn btn-primary btn-sm rounded-pill px-3" onclick="window.postComment('${postId}')">➤</button>
                        </div>
                    </div>
                </div>
            </div>`;
            container.innerHTML += html;
        });

        // --- NACHLADEN DER BILDER (Lazy Loading) ---
        // Wir gehen alle gerade erstellten Bilder durch und prüfen die Datenbank
        document.querySelectorAll('.feed-avatar').forEach(async (img) => {
            const uid = img.getAttribute('data-userid');
            // Wenn es nicht mein eigenes Bild ist (das haben wir oben schon gesetzt)
            if (uid && (!currentUser || uid !== currentUser.uid)) {
                try {
                    // Cache-Check: Haben wir das Bild schonmal geladen? (Performance)
                    if (window.userImageCache && window.userImageCache[uid]) {
                        img.src = window.userImageCache[uid];
                    } else {
                        // Datenbank fragen
                        const snap = await getDoc(doc(db, "users", uid));
                        if (snap.exists()) {
                            const data = snap.data();
                            if (data.photoUrl) {
                                img.src = data.photoUrl;
                                // In Cache speichern für nächstes Mal
                                if(!window.userImageCache) window.userImageCache = {};
                                window.userImageCache[uid] = data.photoUrl;
                            }
                        }
                    }
                } catch(e) { 
                    // Kein Fehler anzeigen, einfach Standard-Bild lassen
                }
            }
        });

    } catch (error) { console.error(error); }
};

window.toggleLike = async (postId) => {
    if (!auth.currentUser) return window.showToast("Bitte erst einloggen!", true);
    const btn = document.getElementById(`btn-like-${postId}`);
    const countSpan = document.getElementById(`like-count-${postId}`);
    const isLiked = btn.classList.contains('liked');
    btn.classList.toggle('liked');
    let currentCount = parseInt(countSpan.innerText.replace(/\D/g, '')) || 0;
    currentCount = isLiked ? currentCount - 1 : currentCount + 1;
    countSpan.innerText = `❤️ ${currentCount} Likes`;

    try {
        await fetch(`${API_URL}/toggleLike`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId: postId, userId: auth.currentUser.uid }) 
        });
    } catch(e) { console.error("Fehler Like", e); }
};

window.postComment = async (postId) => {
    if (!auth.currentUser) return window.showToast("Bitte erst einloggen!", true);
    const input = document.getElementById(`input-comment-${postId}`);
    const text = input.value.trim();
    if (!text) return;
    const list = document.getElementById(`comment-list-${postId}`);
    const username = auth.currentUser.displayName || "Ich";

    const newCommentHtml = `<div class="comment-item"><div class="comment-bubble"><span class="comment-author">${username}</span>${text}</div></div>`;
    list.insertAdjacentHTML('beforeend', newCommentHtml);
    input.value = ""; 

    try {
        await fetch(`${API_URL}/addComment`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, text, user: username }) 
        });
    } catch(e) { console.error(e); }
};

window.insertPostEmoji = function(emoji) {
    const input = document.getElementById('postInputText');
    if (input) {
        input.value += emoji;
        input.focus();
    }
};

/* ==========================================
   PROFIL & USER INTERACTION (KOMPLETT FIX)
   ========================================== */

// Helper zum Namen finden
function findUserInfo(uid) {
    if (!uid) return { name: "Unbekannt", pic: null };
    
    // 1. Suche in Touren
    const tour = toursData.find(t => t.userId === uid);
    if (tour && tour.user) return { name: tour.user, pic: null };

    // 2. Suche in Posts
    const post = allPostsCache.find(p => p.userId === uid);
    if (post && post.user) return { name: post.user, pic: null };

    // 3. Suche in Forum Threads
    const thread = allThreadsCache.find(t => t.userId === uid || t.user === uid); 
    if (thread && thread.user) return { name: thread.user, pic: null };

    // 4. Suche in Kommentaren (Tiefensuche)
    for (const p of allPostsCache) {
        if (p.comments) {
            const comment = p.comments.find(c => c.userId === uid); 
            if (comment && comment.user) return { name: comment.user, pic: null };
        }
    }

    return { name: "User " + uid.substring(0, 5), pic: null };
}

/* ==========================================
   FREUND HINZUFÜGEN (Ersetzen)
   ========================================== */
window.addFriend = async (targetUid) => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);
    if (targetUid === currentUser.uid) return window.showToast("Du kannst dich nicht selbst adden", true);

    // Sicherstellen, dass Array existiert
    if (!currentUser.friends) currentUser.friends = [];
    
    // Prüfen ob schon da
    if (!currentUser.friends.includes(targetUid)) {
        
        // 1. Lokal hinzufügen (für sofortiges Feedback)
        currentUser.friends.push(targetUid);
        
        // Button sofort aktualisieren
        const btn = document.querySelector('button[onclick*="addFriend"]');
        if(btn) { 
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-success');
            btn.innerHTML = "✔ Gespeichert";
            btn.disabled = true;
        }

        // 2. An Backend senden
        try {
            const formData = new FormData();
            formData.append('uid', currentUser.uid);
            formData.append('friends', JSON.stringify(currentUser.friends));
            formData.append('bio', currentUser.bio || ""); // Bio mitsenden, damit sie nicht gelöscht wird

            const response = await fetch(`${API_URL}/updateUser`, { method: 'POST', body: formData });
            
            if(response.ok) {
                window.showToast("Freund hinzugefügt!");
            } else {
                throw new Error("Speicherfehler");
            }
        } catch (e) { 
            console.error(e);
            window.showToast("Fehler beim Speichern - Bitte neu laden", true);
        }

    } else {
        window.showToast("Ihr seid bereits befreundet!");
    }
};
window.openUserProfile = (userId, userName) => {
    let display = userName;
    if(!display || display === 'undefined') {
        const info = findUserInfo(userId);
        display = info.name;
    }

    viewingUserProfile = { 
        uid: userId, 
        displayName: display, 
        isMe: (currentUser && currentUser.uid === userId) 
    };
    navigateTo('profile');
};

window.renderProfilePage = async () => {
    if(allPostsCache.length === 0) await loadFeed();
    const container = document.getElementById('page-profile');
    if (!container) return;
    
    if (!viewingUserProfile && currentUser) {
        viewingUserProfile = { 
            uid: currentUser.uid, 
            displayName: currentUser.displayName || currentUser.email.split('@')[0], 
            isMe: true,
            bio: currentUser.bio || "",
            photoUrl: currentUser.photoUrl || null,
            friends: currentUser.friends || []
        };
    } 

    if (!viewingUserProfile) {
        container.innerHTML = '<div class="p-5 text-center">Lade Profil...</div>';
        return;
    }

    if (!document.getElementById('profile-name')) {
        container.innerHTML = `
        <div style="height: 200px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); border-radius: 0 0 20px 20px;"></div>
        <div class="container" style="margin-top: -60px; position: relative; z-index: 10;">
            <div class="card border-0 shadow rounded-4 overflow-hidden bg-white">
                <div class="card-body p-4">
                    <div class="row align-items-end">
                        <div class="col-auto">
                            <div class="profile-pic-container">
                                <img src="" id="profile-img" class="rounded-circle border border-4 border-white shadow bg-white" 
                                     style="width: 120px; height: 120px; object-fit: cover; background: #eee;">
                            </div>
                        </div>
                        <div class="col-md-6 mb-3 mb-md-0 pt-3 pt-md-0">
                            <h2 class="fw-bold mb-0 text-dark" id="profile-name"></h2>
                            <p class="text-muted mb-0" id="profile-bio"></p>
                            
                            <div class="mt-4 pt-3 border-top">
                                <h6 class="fw-bold small text-uppercase text-muted mb-3">Freunde</h6>
                                <div id="friends-list-container" class="d-flex flex-wrap gap-2">
                                    <div class="spinner-border spinner-border-sm text-muted"></div>
                                </div>
                            </div>

                        </div>
                        <div class="col-md text-md-end pb-2" id="profile-actions"></div>
                    </div>
                    <hr class="my-4">
                    <div id="profile-stats-content">
                        <div class="text-center p-4 text-muted">Lade Aktivitäten...</div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    const nameEl = document.getElementById('profile-name');
    const bioEl = document.getElementById('profile-bio');
    const actionArea = document.getElementById('profile-actions');
    const statsArea = document.getElementById('profile-stats-content');
    const imgEl = document.getElementById('profile-img');
    const friendsContainer = document.getElementById('friends-list-container');

   if(imgEl) {
        // Standard: Erstmal ein Bild mit Initialen generieren (Platzhalter)
        let photo = `https://ui-avatars.com/api/?name=${viewingUserProfile.displayName}&background=random&size=128`;
        
        // 1. Wenn ich es selbst bin ODER das Bild schon geladen wurde -> Nehmen
        if (viewingUserProfile.photoUrl) {
            photo = viewingUserProfile.photoUrl;
        } 
        
        // 2. WICHTIG: Wenn es ein ANDERER User ist -> In Firestore nachsehen!
        else if (!viewingUserProfile.isMe) {
            // Wir fragen die Datenbank: "Gib mir das Bild von diesem User"
            try {
                // HINWEIS: doc und getDoc müssen oben importiert sein!
                getDoc(doc(db, "users", viewingUserProfile.uid)).then(snap => {
                    if(snap.exists()) {
                        const data = snap.data();
                        if (data.photoUrl) {
                            // Bild gefunden -> Sofort austauschen
                            imgEl.src = data.photoUrl;
                        }
                    }
                });
            } catch(e) { console.log("Kein Bild in DB gefunden", e); }
        }
        
        // Erstmal das Platzhalter-Bild anzeigen, bis die Datenbank antwortet
        imgEl.src = photo;
    }
    if (nameEl) nameEl.innerText = viewingUserProfile.displayName;
    if (bioEl) bioEl.innerText = viewingUserProfile.bio || (viewingUserProfile.isMe ? currentUser.email : "Community Mitglied");

    // --- FREUNDESLISTE RENDERN ---
    if (friendsContainer) {
        let friends = viewingUserProfile.friends || [];
        
        // Wenn es mein Profil ist, zeig meine echten Freunde an (auch wenn viewingUserProfile veraltet sein könnte)
        if(viewingUserProfile.isMe && currentUser.friends) {
            friends = currentUser.friends;
        }

        if (!friends || friends.length === 0) {
            friendsContainer.innerHTML = '<small class="text-muted fst-italic">Noch keine Freunde.</small>';
        } else {
            friendsContainer.innerHTML = '';
            // Nur die ersten 5 anzeigen
            const topFriends = friends.slice(0, 5);
            
            topFriends.forEach(friendId => {
                const info = findUserInfo(friendId);
                const fName = info.name;
                const fImg = `https://ui-avatars.com/api/?name=${fName}&size=64&background=random&color=fff`;

                const friendBadge = document.createElement('div');
                friendBadge.className = 'd-flex align-items-center bg-light rounded-pill pe-3 p-1 border';
                friendBadge.style.cursor = 'pointer';
                friendBadge.onclick = () => openUserProfile(friendId, fName);
                friendBadge.innerHTML = `
                    <img src="${fImg}" class="rounded-circle me-2" width="30" height="30">
                    <span class="small fw-bold text-dark" style="max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${fName}</span>
                `;
                friendsContainer.appendChild(friendBadge);
            });

            if (friends.length > 5) {
                const moreBadge = document.createElement('span');
                moreBadge.className = 'badge bg-secondary rounded-pill align-self-center';
                moreBadge.innerText = `+${friends.length - 5}`;
                friendsContainer.appendChild(moreBadge);
            }
        }
    }

    if (actionArea) {
        actionArea.innerHTML = '';
        if (viewingUserProfile.isMe) {
            actionArea.innerHTML = `<button class="btn btn-outline-secondary btn-sm" onclick="openEditProfile()">✏️ Profil bearbeiten</button>`;
        } else {
            const isFriend = currentUser && currentUser.friends && currentUser.friends.includes(viewingUserProfile.uid);
            
            let friendBtn = '';
            if (isFriend) {
                friendBtn = `<button class="btn btn-success btn-sm me-2" disabled>✔ Befreundet</button>`;
            } else {
                friendBtn = `<button class="btn btn-danger btn-sm me-2" onclick="addFriend('${viewingUserProfile.uid}')">🤝 Freund+</button>`;
            }

            actionArea.innerHTML = `
                ${friendBtn}
                <button class="btn btn-dark btn-sm" onclick="openMessageModal('${viewingUserProfile.displayName}')">💬 Nachricht</button>
            `;
        }
    }

   // Statistiken & Ränge & Content
    if (statsArea) {
        const targetName = viewingUserProfile.displayName;
        
        // Daten filtern
        const myTours = toursData.filter(t => t.user === targetName);
        const myPosts = allPostsCache.filter(p => p.user === targetName);
        const myThreads = allThreadsCache.filter(t => t.user === targetName);

        // --- NEU: RANG BERECHNUNG ---
        const totalActivity = myTours.length + myPosts.length + myThreads.length;
        
        let rank = "Starter";       // Standard Name
        let badgeColor = "secondary"; // Grau
        let rankIcon = "🥚"; 

        if (totalActivity >= 10)  { rank = "Asphalt Scout"; badgeColor = "info";    rankIcon = "🧭"; }
        if (totalActivity >= 50)  { rank = "Kurven Jäger";  badgeColor = "warning"; rankIcon = "🏍️"; }
        if (totalActivity >= 100) { rank = "Meilen Fresser";badgeColor = "success"; rankIcon = "🌍"; }
        if (totalActivity >= 250) { rank = "Road King";     badgeColor = "danger";  rankIcon = "👑"; }

        // HTML für den Rang-Badge (wird gleich unten eingebaut)
        const rankBadgeHtml = `<span class="badge bg-${badgeColor} ms-2 shadow-sm">${rankIcon} ${rank}</span>`;
        // -----------------------------

        // Statistik-Balken (Mit Rang-Anzeige jetzt!)
        let html = `<div class="text-center mb-3">
                        ${rankBadgeHtml}
                        <div class="text-muted small mt-1">${totalActivity} Aktivitäten gesamt</div>
                    </div>
                    <div class="d-flex gap-3 mb-4 justify-content-center text-center">
                        <div class="bg-light p-2 rounded px-3 border"><b>${myTours.length}</b><br><small>Touren</small></div>
                        <div class="bg-light p-2 rounded px-3 border"><b>${myPosts.length}</b><br><small>Beiträge</small></div>
                        <div class="bg-light p-2 rounded px-3 border"><b>${myThreads.length}</b><br><small>Themen</small></div>
                    </div>`;

        // Listen Rendern (wie vorher, nur Code verkürzt dargestellt)
        if (myTours.length > 0) {
            html += `<h6 class="fw-bold mt-3">🗺️ Touren</h6><div class="list-group mb-3">`;
            myTours.forEach(t => {
                html += `<a href="#" onclick="selectTour('${t.id}'); navigateTo('tours');" class="list-group-item list-group-item-action border-0 border-bottom">${t.title} <small class="text-muted">(${t.km} km)</small></a>`;
            });
            html += `</div>`;
        }
        
        if (myPosts.length > 0) {
             html += `<h6 class="fw-bold mt-3">📸 Beiträge</h6><div class="list-group mb-3">`;
             myPosts.forEach(p => {
                 html += `<div class="list-group-item list-group-item-action border-0 border-bottom" onclick="navigateTo('home'); setTimeout(() => document.getElementById('post-${p.id}').scrollIntoView(), 500);" style="cursor:pointer;">${p.content || "Medien Inhalt"}</div>`;
             });
             html += `</div>`;
        }

        if (myThreads.length > 0) {
             html += `<h6 class="fw-bold mt-3">💬 Community Themen</h6><div class="list-group mb-3">`;
             myThreads.forEach(t => {
                 html += `<div class="list-group-item list-group-item-action border-0 border-bottom" onclick="openThreadFromProfile('${t.id}', '${t.topic}')" style="cursor:pointer;">${t.title}</div>`;
             });
             html += `</div>`;
        }

        if(totalActivity === 0) {
            html += `<p class="text-center text-muted py-3">Noch keine öffentlichen Aktivitäten.</p>`;
        }
        statsArea.innerHTML = html;
    }
};

window.openEditProfile = () => {
    const bioText = document.getElementById('profile-bio')?.innerText || "";
    const bioInput = document.getElementById('editProfileBio');
    if (bioInput) bioInput.value = bioText;
    
    const modalElement = document.getElementById('editProfileModal');
    if (modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
};

window.previewProfileImage = (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('edit-preview-img').src = e.target.result;
        }
        reader.readAsDataURL(file);
    }
};

window.saveProfile = async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('editProfilePic');
    const newBio = document.getElementById('editProfileBio').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.innerText = "Speichere...";

    try {
        const formData = new FormData();
        formData.append('uid', currentUser.uid);
        formData.append('bio', newBio);
        
        // Wenn eine Datei ausgewählt wurde, hängen wir sie an
        if (fileInput.files.length > 0) {
            formData.append('profilePic', fileInput.files[0]);
        }

        const response = await fetch(`${API_URL}/updateUser`, {
            method: 'POST',
            body: formData 
        });

        if (response.ok) {
            const updatedUser = await response.json();
            try {
                if(updatedUser.photoUrl) {
                    await setDoc(doc(db, "users", currentUser.uid), {
                        photoUrl: updatedUser.photoUrl,
                        displayName: currentUser.displayName
                    }, { merge: true });
                }
            } catch(e) { console.log("Firestore Sync Warnung", e); }
            
            currentUser.bio = updatedUser.bio || newBio;
            if (updatedUser.photoUrl) {
                currentUser.photoUrl = updatedUser.photoUrl;
            }
            
            viewingUserProfile = { ...viewingUserProfile, ...currentUser, isMe: true };
            renderProfilePage();
            
            bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
            window.showToast("✅ Profil erfolgreich gespeichert!");
        } else {
            const errorText = await response.text();
            window.showToast("❌ Fehler: " + errorText, true);
        }
    } catch (err) {
        console.error("Storage-Upload Fehler:", err);
        window.showToast("❌ Netzwerkfehler: " + err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Speichern";
    }
};

/* ==========================================
   ECHTZEIT CHAT (Private Nachrichten)
   ========================================== */
let unsubscribeChat = null; // Um den Chat zu stoppen wenn man das Fenster schließt

// Hilfsfunktion: Erzeugt eine eindeutige ID für das Gespräch zwischen zwei Usern
function getChatId(uid1, uid2) {
    // Sortieren, damit A->B und B->A die gleiche ID haben
    return [uid1, uid2].sort().join("_");
}

/* ==========================================
   CHAT MODAL (FIX: Akzeptiert jetzt direkt eine ID)
   ========================================== */
window.openMessageModal = (name, targetUid = null) => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);
    
    // Fallback: Wenn keine ID übergeben wurde, nimm den User vom aktuellen Profil
    const chatPartnerId = targetUid || (viewingUserProfile ? viewingUserProfile.uid : null);
    
    if (!chatPartnerId) return window.showToast("Fehler: Kein Chat-Partner gefunden.", true);

    const modalEl = document.getElementById('messageModal');
    document.getElementById('msg-recipient').innerText = name;
    
    // Chat-ID generieren
    const chatId = getChatId(currentUser.uid, chatPartnerId);

    // Chat UI vorbereiten (Textarea kleiner, History rein)
    const txtArea = document.getElementById('msg-text');
    if(!document.getElementById('chat-history')) {
        const chatArea = document.createElement('div');
        chatArea.id = 'chat-history';
        chatArea.style.cssText = "height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px; margin-bottom: 10px; background: #f9f9f9; display: flex; flex-direction: column;";
        txtArea.parentNode.insertBefore(chatArea, txtArea);
        txtArea.rows = 2;
        txtArea.placeholder = "Schreibe eine Nachricht...";
    }
    
    // Alten Listener stoppen, falls vorhanden
    if (unsubscribeChat) unsubscribeChat();

    // Nachrichten laden
    const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("createdAt", "asc"));
    
    unsubscribeChat = onSnapshot(q, (snapshot) => {
        const historyDiv = document.getElementById('chat-history');
        historyDiv.innerHTML = ""; 
        
        if (snapshot.empty) {
            historyDiv.innerHTML = '<div class="text-center text-muted mt-5 small">Schreib die erste Nachricht!</div>';
        }

        snapshot.forEach((doc) => {
            const msg = doc.data();
            const isMe = msg.senderId === currentUser.uid;
            
            const bubble = document.createElement('div');
            bubble.style.cssText = `
                max-width: 80%; padding: 8px 12px; margin-bottom: 5px; border-radius: 15px; font-size: 0.9rem;
                align-self: ${isMe ? 'flex-end' : 'flex-start'};
                background-color: ${isMe ? '#0d6efd' : '#e9ecef'};
                color: ${isMe ? '#fff' : '#000'};
            `;
            bubble.innerText = msg.text;
            historyDiv.appendChild(bubble);
        });
        historyDiv.scrollTop = historyDiv.scrollHeight;
    });

    // Wir speichern die Partner-ID im Button, damit sendMessage sie nutzen kann
    window.currentChatPartnerId = chatPartnerId; 

    new bootstrap.Modal(modalEl).show();
};

// Senden Funktion anpassen
window.sendMessage = async () => {
    const textInput = document.getElementById('msg-text');
    const text = textInput.value.trim();
    // Partner ID aus Variable holen oder Fallback
    const partnerId = window.currentChatPartnerId || (viewingUserProfile ? viewingUserProfile.uid : null);
    
    if(!text || !partnerId) return;

    try {
        const chatId = getChatId(currentUser.uid, partnerId);
        
        await addDoc(collection(db, "messages"), {
            text: text,
            senderId: currentUser.uid,
            senderName: currentUser.displayName,
            receiverId: partnerId,
            chatId: chatId,
            createdAt: Date.now()
        });
        textInput.value = ""; 
    } catch (e) {
        console.error(e);
        window.showToast("Senden fehlgeschlagen", true);
    }
};

window.sendMessage = async () => {
    const textInput = document.getElementById('msg-text');
    const text = textInput.value.trim();
    if(!text || !viewingUserProfile) return;

    try {
        const chatId = getChatId(currentUser.uid, viewingUserProfile.uid);
        
        // Nachricht in Firestore speichern
        await addDoc(collection(db, "messages"), {
            text: text,
            senderId: currentUser.uid,
            senderName: currentUser.displayName,
            receiverId: viewingUserProfile.uid,
            chatId: chatId,
            createdAt: Date.now()
        });

        textInput.value = ""; // Feld leeren (Chat aktualisiert sich automatisch durch onSnapshot!)
        
    } catch (e) {
        console.error("Chat Error", e);
        window.showToast("Konnte Nachricht nicht senden (Datenbankfehler)", true);
    }
};

// Wenn Modal geschlossen wird, Listener stoppen (Performance)
const msgModal = document.getElementById('messageModal');
if(msgModal) {
    msgModal.addEventListener('hidden.bs.modal', () => {
        if (unsubscribeChat) unsubscribeChat();
    });
}

window.showToast = (message, isError = false) => {
    const toastEl = document.getElementById('appToast');
    const msgEl = document.getElementById('toast-message');
    
    if (!toastEl || !msgEl) {
        console.log(message);
        return;
    }
    msgEl.innerText = message;
    if (isError) {
        toastEl.classList.remove('bg-success');
        toastEl.classList.add('bg-danger');
    } else {
        toastEl.classList.remove('bg-danger');
        toastEl.classList.add('bg-success');
    }
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
};
/* ==========================================
   NEU: BENACHRICHTIGUNGS-CENTER (Facebook Style)
   ========================================== */

// 1. "Glocke" und Seite automatisch ins HTML einbauen (Start-Injection)
document.addEventListener('DOMContentLoaded', () => {
    // Nav-Item "Glocke" erzeugen
    const navProfile = document.getElementById('nav-profile')?.parentElement;
    if (navProfile && !document.getElementById('nav-notifications')) {
        const li = document.createElement('li');
        li.className = 'nav-item mx-3';
        li.innerHTML = `
            <a class="nav-link d-flex flex-column align-items-center auth-required" id="nav-notifications" onclick="navigateTo('notifications')" style="cursor:pointer">
                🔔 <span class="d-none d-lg-block" style="font-size:0.8rem">News</span>
            </a>`;
        // Vor dem Profil einfügen
        navProfile.parentElement.insertBefore(li, navProfile);
    }

    // Page-Section "Notifications" erzeugen
    const mainContainer = document.querySelector('.container-xl');
    if (mainContainer && !document.getElementById('page-notifications')) {
        const section = document.createElement('section');
        section.id = 'page-notifications';
        section.className = 'page-section';
        section.innerHTML = `
            <div class="row justify-content-center">
                <div class="col-md-8">
                    <h3 class="fw-bold mb-4">🔔 Deine Benachrichtigungen</h3>
                    <div class="card border-0 shadow-sm">
                        <div class="card-body p-0">
                            <div id="notification-list" class="list-group list-group-flush">
                                <div class="text-center p-5 text-muted">Lade Neuigkeiten...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        mainContainer.appendChild(section);
    }
});

//  Die Logik: Sammelt alle Likes und Kommentare ein
/* ==========================================
    NOTIFICATIONS MIT CHAT
   ========================================== */
window.renderNotifications = async () => {
    const list = document.getElementById('notification-list');
    if(!list) return;
    
    list.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    // 1. Feed laden (für Likes/Kommentare)
    if(allPostsCache.length === 0) await loadFeed();

    const myUid = currentUser ? currentUser.uid : null;
    if(!myUid) return;

    let notifs = [];

    // --- A) FEED INTERAKTIONEN (Likes & Kommentare) ---
    allPostsCache.forEach(post => {
        if (post.userId === myUid) {
            // Kommentare
            if (post.comments) {
                post.comments.forEach(c => {
                    if (c.user !== currentUser.displayName) { 
                        notifs.push({
                            type: 'comment',
                            user: c.user,
                            text: `hat kommentiert: "${c.text}"`,
                            linkAction: () => { navigateTo('home'); setTimeout(()=>document.getElementById(`post-${post.id}`).scrollIntoView(), 500); },
                            date: post.createdAt 
                        });
                    }
                });
            }
            // Likes
            if (post.likes) {
                post.likes.forEach(likerUid => {
                    if (likerUid !== myUid) {
                        const info = findUserInfo(likerUid); // Name auflösen
                        notifs.push({
                            type: 'like',
                            user: info.name,
                            text: `gefällt dein Beitrag.`,
                            linkAction: () => { navigateTo('home'); setTimeout(()=>document.getElementById(`post-${post.id}`).scrollIntoView(), 500); },
                            date: post.createdAt 
                        });
                    }
                });
            }
        }
    });

    // --- B) NEU: PRIVATE NACHRICHTEN (Firestore Check) ---
    try {
        // Suche Nachrichten, wo ICH der Empfänger bin
        // Wir holen die letzten 20 Nachrichten an mich
        const qMsg = query(
            collection(db, "messages"), 
            where("receiverId", "==", myUid), 
            orderBy("createdAt", "desc"),
            limit(20)
        );
        
        const snapshot = await getDocs(qMsg);
        
        // Wir wollen pro User nur die NEUESTE Nachricht anzeigen (kein Spam)
        const sendersSeen = new Set();

        snapshot.forEach(doc => {
            const msg = doc.data();
            // Wenn wir von diesem Absender schon eine neuere Nachricht haben -> überspringen
            if (!sendersSeen.has(msg.senderId)) {
                sendersSeen.add(msg.senderId);
                
                notifs.push({
                    type: 'message',
                    user: msg.senderName || "Unbekannt",
                    text: `schrieb: "${msg.text}"`,
                    // FIX: Direktes Öffnen mit ID und Name
                    linkAction: () => { 
                        openMessageModal(msg.senderName, msg.senderId); 
                    },
                    date: new Date(msg.createdAt).toISOString()
                });
            }
        });

    } catch (e) {
        console.error("Fehler beim Laden der Nachrichten:", e);
        // Kein Abbruch, wir zeigen zumindest die Likes an
    }

    // --- RENDERING ---
    list.innerHTML = '';
    if (notifs.length === 0) {
        list.innerHTML = '<div class="text-center p-5 text-muted">Keine neuen Benachrichtigungen.</div>';
        return;
    }

    // Sortieren (Neueste zuerst) - Wir nutzen das Datum string als groben Vergleich
    notifs.sort((a, b) => (b.date > a.date) ? 1 : -1);
    
    notifs.forEach(n => {
        let icon = '🔔';
        let color = 'bg-light';
        
        if (n.type === 'comment') { icon = '💬'; }
        if (n.type === 'like') { icon = '❤️'; color = 'bg-danger-subtle'; }
        if (n.type === 'message') { icon = '📩'; color = 'bg-primary-subtle'; } // Blaue Färbung für Nachrichten

        // HTML Element bauen
        const item = document.createElement('div');
        item.className = `list-group-item list-group-item-action p-3 ${n.type === 'message' ? 'border-start border-4 border-primary' : ''}`;
        item.style.cursor = "pointer";
        item.onclick = n.linkAction; // Die Funktion, die wir oben definiert haben
        
        item.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="me-3 fs-4">${icon}</div>
                <div>
                    <div class="fw-bold text-dark">${n.user}</div>
                    <div class="text-muted small text-truncate" style="max-width: 250px;">${n.text}</div>
                </div>
            </div>`;
            
        list.appendChild(item);
    });
};