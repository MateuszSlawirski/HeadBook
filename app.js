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
    setDoc, 
    updateDoc, 
    arrayUnion
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

/* ==========================================
   SYNC USER (Korrigierte Version)
   ========================================== */
async function syncUserWithBackend(firebaseUser) {
    if (!firebaseUser) return;

    try {
        console.log("Synchronisiere User mit Backend...");
        const response = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName
            })
        });

        if (response.ok) {
            // 1. Erst die Daten vom Azure-Server holen
            const dbUser = await response.json();

            // 2. Auto-Sync: Bild in Firestore speichern (im Hintergrund)
            try {
                if (dbUser.photoUrl) {
                    const userRef = doc(db, "users", firebaseUser.uid);
                    await setDoc(userRef, {
                        photoUrl: dbUser.photoUrl,
                        displayName: dbUser.displayName || firebaseUser.displayName
                    }, { merge: true });
                }
            } catch(e) { console.log("Auto-Sync Info:", e); }

            // 3. WICHTIG: Jetzt Freunde aus Firestore laden und in das User-Objekt mischen
            // Das muss HIER stehen, nachdem dbUser geladen wurde!
            try {
                const mySnap = await getDoc(doc(db, "users", firebaseUser.uid));
                if (mySnap.exists()) {
                    const myData = mySnap.data();
                    if (myData.friends && Array.isArray(myData.friends)) {
                        // Wir packen die Freunde aus der Datenbank in unser User-Objekt
                        dbUser.friends = myData.friends;
                    }
                }
            } catch(e) { console.log("Konnte Freunde nicht laden", e); }
            // -------------------------------------------------------------

            console.log("Daten vom Server erhalten (inkl. Freunde):", dbUser);

            // 4. Jetzt erst den globalen currentUser setzen
            if (currentUser) {
                // Falls schon eingeloggt, Daten aktualisieren
                currentUser.role = dbUser.role || "user";
                currentUser.friends = dbUser.friends || []; 
                currentUser.photoUrl = dbUser.photoUrl || currentUser.photoUrl;
            } else {
                // Falls erster Login
                currentUser = dbUser;
            }

            // UI Updates
            if(window.location.hash === '#profile') renderProfilePage();

        } else {
            console.error("Backend Error:", await response.text());
        }
    } catch (error) {
        console.error("Sync Error:", error);
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
   1. EVENT LISTENERS (ID beim Erstellen mitsenden)
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

    // Thread erstellen: HIER SENDE WIR JETZT DIE userId MIT!
    const createThreadForm = document.getElementById('createThreadForm');
    if (createThreadForm) {
        createThreadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return window.showToast("Bitte logge dich erst ein!", true);
            
            const title = document.getElementById('threadTitle').value;
            const text = document.getElementById('threadText').value;
            
            try {
                // WICHTIG: userId wird hier explizit gesetzt
                const payload = { 
                    topic: currentForumTopic, 
                    title, 
                    text, 
                    user: currentUser.displayName || "Unbekannt",
                    userId: currentUser.uid 
                };
                
                const response = await fetch(`${API_URL}/createThread`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
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

/* ==========================================
   FORUM LEVEL 2: THEMEN LISTE 
   ========================================== */
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
                    von <span class="text-dark fw-bold">${thread.user}</span> 
                    • ${thread.date}
                </div>
            </div>
            <div class="forum-stats fw-bold d-none d-md-block">${thread.replies || 0}</div>
            <div class="text-end text-muted small" style="min-width:100px;">
                ${thread.date}
                ${deleteBtn} 
            </div>
        </div>`;
    });
};

/* ==========================================
   2. THREAD DETAIL (Intelligente Suche & Immer Klickbar)
   ========================================== */
window.renderThreadDetail = async function(threadId, topicName, catId) {
    // Breadcrumbs
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
    
    // Daten laden
    const response = await fetch(`${API_URL}/getThreads?topic=${encodeURIComponent(topicName)}`);
    const threads = await response.json();
    const t = threads.find(thread => thread.id === threadId);
    if (!t) return;

    const deleteThreadBtn = getDeleteBtn('thread', t.id, t.topic);

    // --- NEU: INTELLIGENTER KLICK-HANDLER ---
    // Dieser Handler sucht die ID überall, wenn sie fehlt
    window.handleProfileClick = async (event, username, knownUid) => {
        event.stopPropagation();
        let targetUid = knownUid;

        // 1. Fallback: Bin ich es selbst?
        if (!targetUid && currentUser && currentUser.displayName === username) {
            targetUid = currentUser.uid;
        }

        // 2. Fallback: Suche in lokalen Posts
        if (!targetUid && typeof allPostsCache !== 'undefined') {
             const found = allPostsCache.find(p => p.user === username);
             if(found) targetUid = found.userId;
        }

        // 3. Fallback: Suche LIVE in der Datenbank (User suchen per Name)
        if (!targetUid) {
            window.showToast("🔍 Suche Profil...", false);
            try {
                // Wir nutzen db, da es oben in app.js importiert ist
                const q = query(collection(db, "users"), where("displayName", "==", username), limit(1));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    targetUid = snap.docs[0].id;
                }
            } catch(e) { console.log("User nicht gefunden", e); }
        }

        if (targetUid) {
             // Merken für Zurück-Button
             window.lastForumContext = { threadId, topicName, catId };
             openUserProfile(targetUid, username);
        } else {
             window.showToast("Profil nicht gefunden.", true);
        }
    };

    // Style: Immer Blau & Zeigefinger
    const nameStyle = "cursor:pointer; font-weight:bold; color:#0d6efd; text-decoration:none; transition:all 0.2s;";
    const hoverAttr = `onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"`;

    // --- HTML BAUEN ---
    let html = `
        <h3 class="fw-bold mb-4">${t.title}</h3>
        <div class="card mb-3 border-0 shadow-sm">
            <div class="card-header bg-light border-bottom py-2 d-flex justify-content-between align-items-center">
                <div>
                    <span style="${nameStyle}" ${hoverAttr}
                          onclick="handleProfileClick(event, '${t.user}', '${t.userId || t.uid || ''}')">
                        👤 ${t.user}
                    </span> 
                    <span class="text-muted small ms-2">schrieb am ${t.date}:</span>
                </div>
                <div class="d-flex align-items-center">
                    <span class="text-muted small me-2">#1</span>
                    ${deleteThreadBtn} 
                </div>
            </div>
            <div class="card-body">
                <p class="card-text fs-5" style="white-space: pre-wrap;">${t.text}</p>
            </div>
        </div>`;

    // Antworten rendern
    if (t.repliesList) {
        t.repliesList.forEach((r, idx) => {
            const deleteReplyBtn = getDeleteBtn('reply', null, t.topic, t.id, r.text, r.user);
            
            html += `
            <div class="card mb-3 border-0 shadow-sm ms-3 ms-md-5 bg-white">
                <div class="card-header bg-white border-bottom-0 py-2 d-flex justify-content-between align-items-center">
                    <div>
                        <span style="${nameStyle}" ${hoverAttr}
                              onclick="handleProfileClick(event, '${r.user}', '${r.userId || r.uid || ''}')">
                            👤 ${r.user}
                        </span> 
                        <span class="text-muted small ms-2">antwortete am ${r.date}:</span>
                    </div>
                    <div class="d-flex align-items-center">
                        <span class="text-muted small me-2">#${idx + 2}</span>
                        ${deleteReplyBtn} 
                    </div>
                </div>
                <div class="card-body pt-0">
                    <p class="mb-0" style="white-space: pre-wrap;">${r.text}</p>
                </div>
            </div>`;
        });
    }

    // Antwort-Feld
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
   FREUNDE HINZUFÜGEN (Firestore Lösung)
   ========================================== */
window.addFriend = async (targetUid) => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);

    try {
        // Wir speichern den Freund direkt in DEINER Datenbank-Akte
        const myUserRef = doc(db, "users", currentUser.uid);

        // arrayUnion fügt hinzu, verhindert aber Doppelte automatisch
        await updateDoc(myUserRef, {
            friends: arrayUnion(targetUid)
        });

        window.showToast("Freund hinzugefügt! 🎉");
        
        // Sofortige Anzeige-Aktualisierung (damit der Button grün wird)
        if (!currentUser.friends) currentUser.friends = [];
        if (!currentUser.friends.includes(targetUid)) {
            currentUser.friends.push(targetUid);
        }
        
        // Wenn wir gerade auf dem Profil dieses Users sind -> Seite neu malen
        if (viewingUserProfile && viewingUserProfile.uid === targetUid) {
            renderProfilePage(); 
        }

    } catch (error) {
        console.error("Fehler:", error);
        // Fallback: Falls dein User-Dokument noch nicht existiert
        if (error.code === 'not-found') {
             await setDoc(doc(db, "users", currentUser.uid), { 
                 friends: [targetUid],
                 displayName: currentUser.displayName,
                 photoUrl: currentUser.photoUrl || ""
             }, { merge: true });
             window.showToast("Freund hinzugefügt! 🎉");
             renderProfilePage();
        } else {
            window.showToast("Fehler beim Speichern.", true);
        }
    }
};

/* ==========================================
   PROFIL ÖFFNEN (FIX: Reihenfolge korrigiert)
   ========================================== */
window.openUserProfile = async (uid, name) => {
    console.log("Wechsle Profil zu:", name);

    // 1. ZUERST: Daten setzen! (Damit die App sofort weiß, wer gemeint ist)
    // Wir löschen alte Daten und setzen den neuen Wunsch-User
    viewingUserProfile = { 
        uid: uid, 
        displayName: name || "Lade...", 
        isMe: (currentUser && currentUser.uid === uid),
        friends: [],      
        friendDetails: [],
        bio: "",
        photoUrl: null
    };

    // 2. DANACH: Seite wechseln
    // Jetzt findet renderProfilePage() sofort die richtigen Daten und zeigt nicht mehr DICH an.
    navigateTo('profile');
    
    // 3. Zur Sicherheit: Sofort einmal zeichnen
    if(typeof renderProfilePage === 'function') renderProfilePage();

    // 4. Echte Daten aus der Datenbank nachladen
    try {
        const docSnap = await getDoc(doc(db, "users", uid));

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Objekt mit echten DB-Daten füllen
            viewingUserProfile.displayName = data.displayName || viewingUserProfile.displayName;
            viewingUserProfile.bio = data.bio || "Riderpoint Mitglied";
            viewingUserProfile.photoUrl = data.photoUrl || null;
            viewingUserProfile.friends = data.friends || [];

            // Wenn ich es selbst bin, mein globales Profil updaten
            if (viewingUserProfile.isMe) {
                currentUser.bio = data.bio;
                currentUser.friends = data.friends;
                currentUser.photoUrl = data.photoUrl || currentUser.photoUrl;
            }

            // Bilder der Freunde laden
            if (viewingUserProfile.friends.length > 0) {
                const friendPromises = viewingUserProfile.friends.slice(0, 10).map(fid => getDoc(doc(db, "users", fid)));
                const friendSnaps = await Promise.all(friendPromises);

                viewingUserProfile.friendDetails = [];
                friendSnaps.forEach(snap => {
                    if (snap.exists()) {
                        const fData = snap.data();
                        viewingUserProfile.friendDetails.push({
                            uid: snap.id,
                            name: fData.displayName || "Unbekannt",
                            photoUrl: fData.photoUrl
                        });
                    }
                });
            }

            // 5. Seite final aktualisieren (mit Bio, Bild & Freunden)
            if(typeof renderProfilePage === 'function') renderProfilePage();
        }
    } catch (error) {
        console.error("Fehler beim Profil-Laden:", error);
    }
};

/* ==========================================
   PROFIL SEITE (Neues Design & Interaktive Boxen)
   ========================================== */
window.renderProfilePage = async () => {
    const container = document.getElementById('page-profile');
    if (!container) return;
    
    container.style.position = 'relative'; 

    if(typeof allPostsCache !== 'undefined' && allPostsCache.length === 0) {
        if(typeof loadFeed === 'function') await loadFeed();
    }

    if (!viewingUserProfile && currentUser) {
        viewingUserProfile = { 
            uid: currentUser.uid, 
            displayName: currentUser.displayName || "Ich", 
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
    
    const defaultAvatar = `https://ui-avatars.com/api/?name=${viewingUserProfile.displayName}&background=random&size=128`;

    // --- ZURÜCK BUTTON ---
    let backButtonHtml = "";
    if (window.lastForumContext) {
        const { threadId, topicName, catId } = window.lastForumContext;
        const clickAction = threadId 
            ? `renderThreadDetail('${threadId}', '${topicName}', '${catId}')`
            : `renderForumThreads('${topicName}', '${catId}')`;

        backButtonHtml = `
            <div class="position-absolute top-0 start-0 m-3" style="z-index: 2000;">
                <button class="btn btn-light btn-sm shadow fw-bold border border-secondary" 
                        onclick="navigateTo('forum'); ${clickAction}; window.lastForumContext = null;">
                    ⬅ Zurück
                </button>
            </div>
        `;
    }

    // --- STATISTIKEN ---
    const targetName = viewingUserProfile.displayName;
    const myTours = (typeof toursData !== 'undefined') ? toursData.filter(t => t.user === targetName) : [];
    const myPosts = (typeof allPostsCache !== 'undefined') ? allPostsCache.filter(p => p.user === targetName) : [];
    const myThreads = (typeof allThreadsCache !== 'undefined') ? allThreadsCache.filter(t => t.user === targetName) : [];
    
    const totalActivity = myTours.length + myPosts.length + myThreads.length;
    
    let rank = "Starter", badgeColor = "secondary", rankIcon = "🥚"; 
    if (totalActivity >= 10)  { rank = "Asphalt Scout"; badgeColor = "info";    rankIcon = "🧭"; }
    if (totalActivity >= 50)  { rank = "Kurven Jäger";  badgeColor = "warning"; rankIcon = "🏍️"; }
    if (totalActivity >= 100) { rank = "Meilen Fresser";badgeColor = "success"; rankIcon = "🌍"; }
    if (totalActivity >= 250) { rank = "Road King";     badgeColor = "danger";  rankIcon = "👑"; }

    // --- HTML AUFBAU ---
    container.innerHTML = `
    ${backButtonHtml}
    <div style="height: 200px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); border-radius: 0 0 20px 20px;"></div>
    <div class="container" style="margin-top: -60px; position: relative; z-index: 10;">
        <div class="card border-0 shadow rounded-4 overflow-hidden bg-white">
            <div class="card-body p-4">
                <div class="row align-items-end">
                    <div class="col-auto">
                        <div class="profile-pic-container">
                            <img src="${defaultAvatar}" id="profile-img" 
                                    class="rounded-circle border border-4 border-white shadow bg-white" 
                                    style="width: 120px; height: 120px; object-fit: cover; background: #eee;"
                                    onerror="this.onerror=null;this.src='${defaultAvatar}';"> 
                        </div>
                    </div>
                    <div class="col-md-6 mb-3 mb-md-0 pt-3 pt-md-0">
                        <h2 class="fw-bold mb-0 text-dark" id="profile-name">${viewingUserProfile.displayName}</h2>
                        <p class="text-muted mb-0" id="profile-bio">${viewingUserProfile.bio || "Riderpoint Mitglied"}</p>
                        
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

                <div class="text-center mb-3">
                    <span class="badge bg-${badgeColor} ms-2 shadow-sm">${rankIcon} ${rank}</span>
                    <div class="text-muted small mt-1">${totalActivity} Aktivitäten gesamt</div>
                </div>

                <div class="d-flex gap-3 mb-4 justify-content-center text-center">
                    
                    <div class="bg-light p-2 rounded px-3 border shadow-sm tab-box" 
                         onclick="switchProfileTab('tours')" style="cursor:pointer; min-width: 90px;">
                        <b class="fs-5">${myTours.length}</b><br><small>Touren</small>
                    </div>
                    
                    <div class="bg-light p-2 rounded px-3 border shadow-sm tab-box" 
                         onclick="switchProfileTab('posts')" style="cursor:pointer; min-width: 90px;">
                        <b class="fs-5">${myPosts.length}</b><br><small>Beiträge</small>
                    </div>
                    
                    <div class="bg-light p-2 rounded px-3 border shadow-sm tab-box" 
                         onclick="switchProfileTab('threads')" style="cursor:pointer; min-width: 90px;">
                        <b class="fs-5">${myThreads.length}</b><br><small>Themen</small>
                    </div>

                </div>

                <div id="profile-dynamic-content" class="mt-3">
                    <div class="text-center text-muted small fst-italic py-3">
                        Klicke auf eine Box oben, um Aktivitäten zu sehen.
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    // 1. Bild
    const imgEl = document.getElementById('profile-img');
    if(imgEl && viewingUserProfile.photoUrl) imgEl.src = viewingUserProfile.photoUrl;

    // 2. Freunde
    if(typeof renderFriendsList === 'function') {
        const friendsContainer = document.getElementById('friends-list-container');
        renderFriendsList(friendsContainer);
    }

    // 3. Actions
    const actionArea = document.getElementById('profile-actions');
    if (actionArea) {
        if (viewingUserProfile.isMe) {
            actionArea.innerHTML = `
                <button id="btn-inbox" class="btn btn-primary btn-sm me-2 position-relative" onclick="openInbox()">
                    📬 Mein Postfach
                    <span id="inbox-badge" class="position-absolute top-0 start-100 translate-middle p-2 bg-danger border border-light rounded-circle d-none"></span>
                </button>
                <button class="btn btn-outline-secondary btn-sm" onclick="openEditProfile()">✏️ Profil bearbeiten</button>
            `;
            try {
                const qCheck = query(collection(db, "messages"), where("receiverId", "==", currentUser.uid), where("read", "==", false), limit(1));
                getDocs(qCheck).then(snap => { if (!snap.empty) document.getElementById('inbox-badge')?.classList.remove('d-none'); });
            } catch(e){}
        } else {
            const isFriend = currentUser && currentUser.friends && currentUser.friends.includes(viewingUserProfile.uid);
            let friendBtn = isFriend 
                ? `<button class="btn btn-success btn-sm me-2" disabled>✔ Befreundet</button>`
                : `<button class="btn btn-danger btn-sm me-2" onclick="addFriend('${viewingUserProfile.uid}')">🤝 Freund+</button>`;

            actionArea.innerHTML = `
                ${friendBtn}
                <button class="btn btn-dark btn-sm" onclick="openMessageModal('${viewingUserProfile.displayName}', '${viewingUserProfile.uid}')">💬 Nachricht senden</button>
            `;
        }
    }
};

/* ==========================================
   PROFIL TABS (Mit Admin-Lösch-Button)
   ========================================== */
window.switchProfileTab = (type) => {
    const container = document.getElementById('profile-dynamic-content');
    if (!container || !viewingUserProfile) return;
    
    document.querySelectorAll('.tab-box').forEach(el => el.classList.remove('border-primary', 'bg-white'));
    const targetName = viewingUserProfile.displayName;
    let html = `<div class="list-group list-group-flush animate__animated animate__fadeIn">`;
    let count = 0;

    // TOUREN
    if (type === 'tours') {
        const myTours = toursData.filter(t => t.user === targetName);
        if (myTours.length === 0) html += `<div class="p-3 text-center text-muted">Keine Touren gefunden.</div>`;
        myTours.forEach(t => {
            const delBtn = getDeleteBtn('tour', t.id, t.id); // <--- HIER IST DER BUTTON
            html += `
            <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3"
                 onclick="selectTour('${t.id}'); navigateTo('tours');" style="cursor:pointer;">
                <div>
                    <div class="fw-bold text-primary">🗺️ ${t.title}</div>
                    <small class="text-muted">${t.km} km • ${t.country}</small>
                </div>
                <div>${delBtn}</div>
            </div>`;
        });
        count = myTours.length;
    }

    // BEITRÄGE
    else if (type === 'posts') {
        const myPosts = allPostsCache.filter(p => p.user === targetName);
        if (myPosts.length === 0) html += `<div class="p-3 text-center text-muted">Keine Beiträge gefunden.</div>`;
        myPosts.forEach(p => {
            const delBtn = getDeleteBtn('post', p.id, p.userId); // <--- HIER IST DER BUTTON
            html += `
            <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3"
                 onclick="navigateTo('home'); setTimeout(() => document.getElementById('post-${p.id}').scrollIntoView(), 500);" style="cursor:pointer;">
                <div class="text-truncate" style="max-width: 80%;">
                    <div class="fw-bold">📸 Beitrag</div>
                    <small class="text-muted">${p.content || "Bild-Inhalt"}</small>
                </div>
                <div>${delBtn}</div>
            </div>`;
        });
        count = myPosts.length;
    }

    // THEMEN
    else if (type === 'threads') {
        const myThreads = allThreadsCache.filter(t => t.user === targetName);
        if (myThreads.length === 0) html += `<div class="p-3 text-center text-muted">Keine Themen gefunden.</div>`;
        myThreads.forEach(t => {
            const delBtn = getDeleteBtn('thread', t.id, t.topic); // <--- HIER IST DER BUTTON
            html += `
            <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3"
                 onclick="openThreadFromProfile('${t.id}', '${t.topic}')" style="cursor:pointer;">
                <div>
                    <div class="fw-bold text-success">💬 ${t.title}</div>
                    <small class="text-muted">in ${t.topic}</small>
                </div>
                <div>${delBtn}</div>
            </div>`;
        });
        count = myThreads.length;
    }

    html += `</div>`;
    const titles = { tours: "Touren", posts: "Beiträge", threads: "Forum-Themen" };
    container.innerHTML = `<h6 class="fw-bold text-muted text-uppercase small mb-3 border-bottom pb-2">${titles[type]} (${count})</h6>` + html;
};
/* HILFSFUNKTION: FREUNDE RENDERN (Damit wir sie oben neu aufrufen können) */
async function renderFriendsList(container) {
    if(!container) return;
    
    // Welche Liste nutzen wir?
    let list = viewingUserProfile.friendDetails || []; 
    // Fallback auf IDs, falls Details leer
    if (list.length === 0 && viewingUserProfile.friends) list = viewingUserProfile.friends;
    
    // Eigener User: Immer Live-Daten nehmen
    if (viewingUserProfile.isMe && currentUser.friends) {
        // Falls wir noch keine Details geladen haben, nehmen wir erstmal die IDs von currentUser
        if (list.length < currentUser.friends.length) list = currentUser.friends;
    }

    if (!list || list.length === 0) {
        container.innerHTML = '<small class="text-muted fst-italic">Noch keine Freunde.</small>';
        return;
    }

    container.innerHTML = '';
    const topFriends = list.slice(0, 5);

    for (const item of topFriends) {
        let fUid, fName, fImg;

        // Prüfen: Ist item ein Objekt (Details) oder nur ein String (ID)?
        if (typeof item === 'object') {
            fUid = item.uid; fName = item.name; fImg = item.photoUrl;
        } else {
            fUid = item; fName = "Lade..."; fImg = `https://ui-avatars.com/api/?name=?&background=eee`;
            // Versuch Cache
            if(window.findUserInfo) { try{ let i = findUserInfo(fUid); if(i) fName = i.name; }catch(e){} }
            
            // Wenn wir nur die ID haben, laden wir das Bild im Hintergrund nach
            getDoc(doc(db, "users", fUid)).then(snap => {
                if(snap.exists()) {
                    const d = snap.data();
                    // Wir aktualisieren das Bild direkt im DOM, sobald es da ist
                    const imgTag = document.getElementById(`friend-img-${fUid}`);
                    const nameTag = document.getElementById(`friend-name-${fUid}`);
                    if(imgTag && d.photoUrl) imgTag.src = d.photoUrl;
                    if(nameTag && d.displayName) nameTag.innerText = d.displayName;
                }
            });
        }

        const badge = document.createElement('div');
        badge.className = 'd-flex align-items-center bg-light rounded-pill pe-3 p-1 border shadow-sm';
        badge.style.cursor = 'pointer';
        badge.onclick = () => openUserProfile(fUid, fName);
        badge.innerHTML = `
            <img src="${fImg}" id="friend-img-${fUid}" class="rounded-circle me-2 border" width="30" height="30" style="object-fit:cover;" onerror="this.src='https://ui-avatars.com/api/?name=${fName}'">
            <span id="friend-name-${fUid}" class="small fw-bold text-dark" style="max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${fName}</span>
        `;
        container.appendChild(badge);
    }
    
    if (list.length > 5) {
        container.innerHTML += `<span class="badge bg-secondary rounded-pill align-self-center ms-1">+${list.length - 5}</span>`;
    }
}

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

        if (fileInput.files.length > 0) {
            formData.append('profilePic', fileInput.files[0]);
        }

        const response = await fetch(`${API_URL}/updateUser`, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            // --- HIER WAR DER FEHLER: Diese Zeile fehlte! ---
            const updatedUser = await response.json(); 
            // -----------------------------------------------

            try {
                // Wir speichern ALLES Wichtige in der Datenbank
                await setDoc(doc(db, "users", currentUser.uid), {
                    photoUrl: updatedUser.photoUrl || currentUser.photoUrl,
                    displayName: currentUser.displayName,
                    bio: newBio, 
                }, { merge: true });

                // Lokal aktualisieren
                currentUser.bio = newBio;
                
            } catch(e) { console.log("Firestore Sync Warnung", e); }

            // Weitere lokale Updates
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
        console.error(err);
        window.showToast("Fehler beim Speichern", true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Speichern";
    }
};




/* ==========================================
   NEU: MESSENGER & POSTFACH (Mit Zeitstempel & Gelesen-Status)
   ========================================== */
let unsubscribeChat = null; 

// Hilfsfunktion: ID generieren
function getChatId(uid1, uid2) {
    return [uid1, uid2].sort().join("_");
}



// 1. DAS POSTFACH
window.openInbox = async () => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);

    let inboxModal = document.getElementById('inboxModal');
    if (!inboxModal) {
        const modalHtml = `
        <div class="modal fade" id="inboxModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">📬 Mein Postfach</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body p-0">
                        <ul class="nav nav-tabs nav-justified" id="inboxTabs" role="tablist">
                            <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tab-chats">💬 Letzte Chats</button></li>
                            <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-friends">👥 Freunde</button></li>
                        </ul>
                        <div class="tab-content p-3">
                            <div class="tab-pane fade show active" id="tab-chats">
                                <div id="inbox-chats-list" class="list-group list-group-flush"><div class="text-center p-3"><div class="spinner-border text-primary"></div></div></div>
                            </div>
                            <div class="tab-pane fade" id="tab-friends">
                                <div id="inbox-friends-list" class="list-group list-group-flush"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        inboxModal = document.getElementById('inboxModal');
    }

    const modal = new bootstrap.Modal(inboxModal);
    modal.show();

    // A) Letzte Chats laden
    const chatListEl = document.getElementById('inbox-chats-list');
    chatListEl.innerHTML = '';
    
    // ... in openInbox ...

    // A) Letzte Chats laden
    try {
        const q = query(collection(db, "messages"), where("receiverId", "==", currentUser.uid), orderBy("createdAt", "desc"), limit(50));
        const snapshot = await getDocs(q);
        const chatPartners = new Set();
        
        if(snapshot.empty) {
             chatListEl.innerHTML = '<div class="text-center text-muted mt-3">Noch keine Nachrichten erhalten.</div>';
        } else {
            // Wir müssen warten, bis wir alle Bilder geladen haben
            // Array für die HTML-Elemente vorbereiten
            const chatItems = [];

            for (const docSnap of snapshot.docs) {
                const msg = docSnap.data();
                if (!chatPartners.has(msg.senderId)) {
                    chatPartners.add(msg.senderId);
                    
                    // Standard: UI Avatar
                    let avatarUrl = `https://ui-avatars.com/api/?name=${msg.senderName}&background=random&size=64`;

                    // VERSUCH: Echtes Bild aus Datenbank laden
                    try {
                        const userSnap = await getDoc(doc(db, "users", msg.senderId));
                        if(userSnap.exists() && userSnap.data().photoUrl) {
                            avatarUrl = userSnap.data().photoUrl;
                        }
                    } catch(e) { /* Bild nicht gefunden, egal -> Platzhalter bleibt */ }

                    const fontWeight = (msg.read === false) ? 'fw-bolder text-primary' : 'fw-normal';
                    
                    // HTML bauen
                    const itemHtml = `
                    <div class="list-group-item list-group-item-action d-flex align-items-center p-2" style="cursor:pointer;" 
                         onclick="bootstrap.Modal.getInstance(document.getElementById('inboxModal')).hide(); openMessageModal('${msg.senderName}', '${msg.senderId}')">
                        
                        <img src="${avatarUrl}" class="rounded-circle border me-3" style="width:50px; height:50px; object-fit:cover;">
                        
                        <div class="flex-grow-1">
                            <div class="fw-bold">${msg.senderName}</div>
                            <div class="${fontWeight} text-truncate" style="max-width:200px;">${msg.text}</div>
                        </div>
                        <div class="text-end">
                            <small class="text-muted d-block" style="font-size:0.75rem">${new Date(msg.createdAt).toLocaleDateString()}</small>
                            <small class="text-muted" style="font-size:0.7rem">${new Date(msg.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>
                        </div>
                    </div>`;
                    
                    chatListEl.insertAdjacentHTML('beforeend', itemHtml);
                }
            }
        }
    } catch(e) { console.error(e); chatListEl.innerHTML = '<div class="text-danger p-2">Laden fehlgeschlagen.</div>'; }

    // B) Freundesliste
    const friendsListEl = document.getElementById('inbox-friends-list');
    friendsListEl.innerHTML = '';
    
    if (currentUser.friends && currentUser.friends.length > 0) {
        currentUser.friends.forEach(fid => {
            const info = findUserInfo(fid);
            const item = document.createElement('div');
            item.className = 'list-group-item list-group-item-action d-flex align-items-center p-2';
            item.onclick = () => { modal.hide(); openMessageModal(info.name, fid); };
            item.innerHTML = `
                <div class="me-3 fs-4">🟢</div>
                <div class="fw-bold">${info.name}</div>
            `;
            friendsListEl.appendChild(item);
        });
    } else {
        friendsListEl.innerHTML = '<div class="text-muted text-center p-3">Du hast noch keine Freunde hinzugefügt.</div>';
    }
};

// 2. CHAT FENSTER (Mit Zeitstempel & Gelesen-Logik)
window.openMessageModal = (name, targetUid) => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);
    const partnerId = targetUid || (viewingUserProfile ? viewingUserProfile.uid : null);
    if (!partnerId) return window.showToast("Fehler: Chat-Partner unbekannt", true);

    const modalEl = document.getElementById('messageModal');
    document.getElementById('msg-recipient').innerText = name;
    
    const txtArea = document.getElementById('msg-text');
    let chatHistory = document.getElementById('chat-history');
    if(!chatHistory) {
        chatHistory = document.createElement('div');
        chatHistory.id = 'chat-history';
        chatHistory.style.cssText = "height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px; margin-bottom: 10px; background: #f9f9f9; display: flex; flex-direction: column;";
        txtArea.parentNode.insertBefore(chatHistory, txtArea);
        txtArea.rows = 2; 
        txtArea.placeholder = "Nachricht schreiben...";
    }
    
    if (unsubscribeChat) unsubscribeChat();

    const chatId = getChatId(currentUser.uid, partnerId);
    const q = query(collection(db, "messages"), where("chatId", "==", chatId), orderBy("createdAt", "asc"));
    
    unsubscribeChat = onSnapshot(q, (snapshot) => {
        chatHistory.innerHTML = ""; 
        if (snapshot.empty) chatHistory.innerHTML = '<div class="text-center text-muted mt-5 small">Schreib die erste Nachricht!</div>';

        snapshot.forEach((docSnapshot) => {
            const msg = docSnapshot.data();
            const isMe = msg.senderId === currentUser.uid;
            
            // --- NEU: Zeitstempel formatieren (z.B. 14:30) ---
            const timeStr = new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            // --- NEU: Nachricht als GELESEN markieren (wenn sie von anderen ist und noch ungelesen) ---
            if (!isMe && msg.read === false) {
                // Wir updaten das Dokument in der Datenbank
                try {
                    updateDoc(docSnapshot.ref, { read: true });
                } catch(e) { console.log("Konnte nicht als gelesen markieren", e); }
            }

            const bubble = document.createElement('div');
            bubble.style.cssText = `
                max-width: 80%; padding: 8px 12px; margin-bottom: 5px; border-radius: 15px; font-size: 0.9rem; position: relative;
                align-self: ${isMe ? 'flex-end' : 'flex-start'};
                background-color: ${isMe ? '#0d6efd' : '#e9ecef'};
                color: ${isMe ? '#fff' : '#000'};
            `;
            
            // Text + kleine Uhrzeit
            bubble.innerHTML = `
                <div>${msg.text}</div>
                <div style="font-size: 0.7em; opacity: 0.7; text-align: right; margin-top: 2px;">${timeStr}</div>
            `;
            chatHistory.appendChild(bubble);
        });
        chatHistory.scrollTop = chatHistory.scrollHeight;
    });

    window.currentChatPartnerId = partnerId; 
    new bootstrap.Modal(modalEl).show();
};

// 3. SENDEN (Mit read: false)
window.sendMessage = async () => {
    const textInput = document.getElementById('msg-text');
    const text = textInput.value.trim();
    const partnerId = window.currentChatPartnerId;
    
    if(!text || !partnerId) return;

    try {
        const chatId = getChatId(currentUser.uid, partnerId);
        await addDoc(collection(db, "messages"), {
            text: text,
            senderId: currentUser.uid,
            senderName: currentUser.displayName,
            receiverId: partnerId,
            chatId: chatId,
            createdAt: Date.now(),
            read: false  // <--- NEU: Standardmäßig ungelesen
        });
        textInput.value = ""; 
    } catch (e) {
        console.error(e);
        window.showToast("Sendefehler", true);
    }
};

// Listener aufräumen
const msgModal = document.getElementById('messageModal');
if(msgModal) {
    msgModal.addEventListener('hidden.bs.modal', () => {
        if (unsubscribeChat) unsubscribeChat();
        // Beim Schließen prüfen wir den Badge nochmal neu
        if(window.renderProfilePage && viewingUserProfile && viewingUserProfile.isMe) {
             renderProfilePage(); 
        }
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
   APP START (Fix: Schwarzer Punkt weg & Auto-Sync)
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    
    // 1. NAVIGATION: Glocke einfügen (Ohne schwarzen Punkt)
    const navProfile = document.getElementById('nav-profile')?.parentElement;
    if (navProfile && !document.getElementById('nav-notifications')) {
        const li = document.createElement('li');
        li.className = 'nav-item mx-3';
        li.style.listStyle = 'none'; // <--- DAS ENTFERNT DEN SCHWARZEN PUNKT!
        li.innerHTML = `
            <a class="nav-link d-flex flex-column align-items-center auth-required position-relative" 
               id="nav-notifications" 
               onclick="navigateTo('notifications'); hideNotificationBadge();" 
               style="cursor:pointer">
                
                🔔 
                <span id="nav-badge" class="position-absolute top-0 start-100 translate-middle p-1 bg-danger border border-light rounded-circle d-none">
                    <span class="visually-hidden">Neu</span>
                </span>
                
                <span class="d-none d-lg-block" style="font-size:0.8rem">Benachrichtigung</span>
            </a>`;
        navProfile.parentElement.insertBefore(li, navProfile);
    }
    
    // Notification Page Section
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

    // Auth Listener
    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        if (user) {
            updateUI(); 
            await syncUserWithBackend(user); 
            
            // Startet die Überwachung UND prüft sofort auf Neuigkeiten
            startNotificationListener(); 

            if (getActivePage() === 'home') loadFeed();
            if (getActivePage() === 'profile') { viewingUserProfile = null; renderProfilePage(); }
        } else {
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
    if (!currentUser) navigateTo(startPage);
});

// --- HELPER FÜR DEN ROTEN PUNKT ---
function startNotificationListener() {
    if (!currentUser) return;

    // 1. Live-Check auf ungelesene Nachrichten (Firestore)
    const q = query(collection(db, "messages"), where("receiverId", "==", currentUser.uid), where("read", "==", false));
    onSnapshot(q, (snap) => {
        if (!snap.empty) {
            showNotificationBadge();
        } else {
            // Wenn keine Nachrichten, prüfen wir noch auf "neue Aktivitäten" (lokal gespeichert)
            checkActivityBadge();
        }
    });
}

function checkActivityBadge() {
    // Prüft, ob der neueste Post neuer ist als der letzte Klick auf die Glocke
    const lastSeen = localStorage.getItem('last_notif_check') || 0;
    if (allPostsCache.length > 0) {
        const newestPostDate = new Date(allPostsCache[0].createdAt).getTime();
        if (newestPostDate > new Date(lastSeen).getTime()) {
            showNotificationBadge();
        }
    }
}

function showNotificationBadge() {
    const badge = document.getElementById('nav-badge');
    if(badge) badge.classList.remove('d-none');
}

window.hideNotificationBadge = () => {
    const badge = document.getElementById('nav-badge');
    if(badge) badge.classList.add('d-none');
    // Zeitstempel merken
    localStorage.setItem('last_notif_check', new Date().toISOString());
};

/* ==========================================
   NOTIFICATION SYSTEM (Sync, Zeitstempel, Red Dot)
   ========================================== */

// 1. LISTENER & SYNC BEIM START
function startNotificationListener() {
    if (!currentUser) return;

    // A) Live-Check auf ungelesene Chat-Nachrichten
    const q = query(collection(db, "messages"), where("receiverId", "==", currentUser.uid), where("read", "==", false));
    onSnapshot(q, (snap) => {
        if (!snap.empty) {
            showNotificationBadge();
        }
    });

    // B) Sync beim Refresh: Prüfen ob es neue Aktivitäten gab seit dem letzten Mal
    // Wir warten kurz (2sek), bis Feed & Forum geladen sind, dann prüfen wir
    setTimeout(checkActivityBadge, 2000); 
    // Und nochmal alle 30 Sekunden
    setInterval(checkActivityBadge, 30000);
}

// Prüft ALLE Daten auf Neuigkeiten (für den roten Punkt nach Refresh)
function checkActivityBadge() {
    if (!currentUser) return;
    const lastCheckStr = localStorage.getItem('last_notif_check');
    // Wenn noch nie geklickt wurde -> Rot
    if (!lastCheckStr) { showNotificationBadge(); return; }

    const lastCheck = new Date(lastCheckStr).getTime();
    let hasNews = false;

    // 1. Meine Beiträge checken (Likes/Kommentare)
    allPostsCache.forEach(p => {
        if (p.userId === currentUser.uid) {
            // Neue Kommentare?
            if (p.comments) {
                const newComm = p.comments.find(c => c.user !== currentUser.displayName && new Date(p.createdAt).getTime() > lastCheck); // Vereinfacht: wir checken Post-Datum oder bräuchten Kommentar-Datum
                // Da Kommentar-Datum oft fehlt, prüfen wir hier einfachheitshalber:
                // Wenn der Post selbt Kommentare hat und wir den Punkt noch nicht gelöscht haben...
                // Besser: Wir verlassen uns auf die Logik unten.
            }
        }
    });
    
    // Einfache Logik: Wir generieren kurz die Liste intern und schauen auf das Datum des neusten Elements
    // Das ist am sichersten.
    const latestItemDate = getLatestNotificationDate();
    if (latestItemDate > lastCheck) {
        showNotificationBadge();
    }
}

function getLatestNotificationDate() {
    let maxDate = 0;
    const myUid = currentUser.uid;
    const myName = currentUser.displayName;

    // Feed Scannen
    allPostsCache.forEach(post => {
        // Kommentare auf meine Posts
        if (post.userId === myUid && post.comments) {
             // Da Kommentare kein Datum haben (im einfachen Modell), nehmen wir Post-Update-Zeit oder Post-Zeit
             // Workaround: Wir nehmen an, Kommentare sind aktuell.
        }
        // Freunde Posts
        if (currentUser.friends && currentUser.friends.includes(post.userId)) {
            const d = new Date(post.createdAt).getTime();
            if (d > maxDate) maxDate = d;
        }
    });
    
    // Forum Scannen
    allThreadsCache.forEach(t => {
        if ((t.user === myName || t.userId === myUid) && t.repliesList) {
            t.repliesList.forEach(r => {
                if (r.user !== myName) {
                    // Versuche Datum zu parsen (Forum Datum ist String "DD.MM.YYYY")
                    // Das ist schwer zu vergleichen, wir setzen es auf "Jetzt" wenn neu, 
                    // aber für den Badge Check reicht oft der Chat und Feed.
                }
            });
        }
    });

    return maxDate;
}

function showNotificationBadge() {
    const badge = document.getElementById('nav-badge');
    if(badge) badge.classList.remove('d-none');
}

window.hideNotificationBadge = () => {
    const badge = document.getElementById('nav-badge');
    if(badge) badge.classList.add('d-none');
    localStorage.setItem('last_notif_check', new Date().toISOString());
};

// 2. RENDERING (Liste anzeigen)
window.renderNotifications = async () => {
    const list = document.getElementById('notification-list');
    if(!list) return;
    
    list.innerHTML = '<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    const myUid = currentUser ? currentUser.uid : null;
    const myName = currentUser ? currentUser.displayName : null;
    if(!myUid) return;

    if(allPostsCache.length === 0) await loadFeed();
    if(allThreadsCache.length === 0) await loadForumData(); 

    let notifs = [];

    // A) FEED INTERAKTIONEN
    allPostsCache.forEach(post => {
        if (post.userId === myUid) {
            if (post.comments) {
                post.comments.forEach(c => {
                    if (c.user !== myName) { 
                        notifs.push({
                            type: 'comment',
                            user: c.user,
                            text: `hat kommentiert: "${c.text}"`,
                            linkAction: () => { navigateTo('home'); setTimeout(()=>document.getElementById(`post-${post.id}`).scrollIntoView(), 500); },
                            date: post.createdAt // Fallback, da Kommentar kein Datum hat
                        });
                    }
                });
            }
            if (post.likes) {
                post.likes.forEach(likerUid => {
                    if (likerUid !== myUid) {
                        const info = findUserInfo(likerUid);
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
        // Freunde Posts
        if (currentUser.friends && currentUser.friends.includes(post.userId)) {
             const daysOld = (new Date() - new Date(post.createdAt)) / (1000 * 60 * 60 * 24);
             if (daysOld < 3) {
                 notifs.push({
                    type: 'friend_post',
                    user: post.user,
                    text: `neuer Beitrag: "${post.content.substring(0, 20)}..."`,
                    linkAction: () => { navigateTo('home'); setTimeout(()=>document.getElementById(`post-${post.id}`).scrollIntoView(), 500); },
                    date: post.createdAt
                 });
             }
        }
    });

    // B) FORUM
    allThreadsCache.forEach(thread => {
        if (thread.user === myName || thread.userId === myUid) {
            if (thread.repliesList) {
                thread.repliesList.forEach(reply => {
                    if (reply.user !== myName) {
                        notifs.push({
                            type: 'forum_reply',
                            user: reply.user,
                            text: `antwortete im Thema "${thread.title}".`,
                            linkAction: () => { openThreadFromProfile(thread.id, thread.topic); }, 
                            date: null // Datum ist String, wird unten behandelt
                        });
                    }
                });
            }
        }
    });

    // C) NACHRICHTEN
    try {
        const qMsg = query(collection(db, "messages"), where("receiverId", "==", myUid), orderBy("createdAt", "desc"), limit(20));
        const snapshot = await getDocs(qMsg);
        const sendersSeen = new Set();
        snapshot.forEach(doc => {
            const msg = doc.data();
            if (!sendersSeen.has(msg.senderId)) {
                sendersSeen.add(msg.senderId);
                const isNew = !msg.read;
                notifs.push({
                    type: 'message',
                    user: msg.senderName || "Unbekannt",
                    text: `schrieb: "${msg.text}"`,
                    isNew: isNew,
                    linkAction: () => { openUserProfile(msg.senderId, msg.senderName); setTimeout(() => openMessageModal(msg.senderName, msg.senderId), 500); },
                    date: new Date(msg.createdAt).toISOString()
                });
            }
        });
    } catch (e) { console.error("Fehler Messages:", e); }

    // D) SORTIEREN & ZEITSTEMPEL
    list.innerHTML = '';
    if (notifs.length === 0) {
        list.innerHTML = '<div class="text-center p-5 text-muted">Keine neuen Benachrichtigungen.</div>';
        return;
    }

    // Neueste zuerst
    notifs.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
    });
    
    notifs.forEach(n => {
        let icon = '🔔';
        let colorClass = 'list-group-item-action'; 
        let borderClass = '';

        if (n.type === 'comment') { icon = '💬'; }
        if (n.type === 'like') { icon = '❤️'; }
        if (n.type === 'friend_post') { icon = '📰'; colorClass = 'bg-light'; }
        if (n.type === 'forum_reply') { icon = '🔧'; }
        if (n.type === 'message') { 
            icon = '📩'; 
            colorClass = 'bg-primary-subtle'; // Blau für Nachrichten
            if(n.isNew) borderClass = 'border-start border-4 border-danger'; // Roter Rand wenn neu
        }

        // Datum formatieren: 12.01.2026, 14:30
        let timeString = "";
        if(n.date) {
            timeString = new Date(n.date).toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
        }

        const item = document.createElement('div');
        item.className = `list-group-item ${colorClass} p-3 ${borderClass}`;
        item.style.cursor = "pointer";
        item.onclick = n.linkAction;
        
        item.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="me-3 fs-4">${icon}</div>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between">
                        <span class="fw-bold text-dark">${n.user}</span>
                        <small class="text-muted" style="font-size:0.75rem">${timeString}</small>
                    </div>
                    <div class="text-muted small text-truncate" style="max-width: 250px;">${n.text}</div>
                </div>
            </div>`;
            
        list.appendChild(item);
    });
}
