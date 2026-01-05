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

// Azure Backend URL:
const API_URL = "https://riderpoint-backend.azurewebsites.net/api";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// STATE VARIABLES
let allPostsCache = []; 
let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let viewingUserProfile = null; 

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
    if(window.loadFeed) window.loadFeed();
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

        // Profil laden
        if (pageId === 'profile') {
            if (typeof renderProfilePage === 'function') {
                renderProfilePage();
            }
        }
        
        // Refresh bei Klick auf "Touren"
        if (pageId === 'tours' && map) {
            setTimeout(() => { 
                map.invalidateSize(); 
                map.setView([51.16, 10.45], 6); 
                if (currentRouteLayer) map.removeLayer(currentRouteLayer);
            }, 200);
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
        const response = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: firebaseUser.uid, email: firebaseUser.email })
        });

        if(response.ok) {
            const dbUser = await response.json();
            currentRole = dbUser.role || "user"; 
            console.log("Rolle erkannt:", currentRole);
            updateUI(); 

            if (window.loadFeed) window.loadFeed(); 
            loadToursFromServer();                  
            if (getActivePage() === 'forum') renderForumHome();
        }
    } catch (err) { 
        console.warn("Backend Sync skip", err); 
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
    if(btnLogout) btnLogout.addEventListener('click', async () => { await signOut(auth); navigateTo('home'); });

    const authForm = document.getElementById('authForm');
    if(authForm) authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const isReg = document.getElementById('authNameContainer').style.display === 'block';
        if (isReg) handleRegister(); else handleLogin(e);
    });

    // Forum: Thread erstellen
    const createThreadForm = document.getElementById('createThreadForm');
    if (createThreadForm) {
        createThreadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return alert("Bitte logge dich erst ein!");
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
                }
            } catch (err) { alert(err.message); }
        });
    }

    // Forum: Kategorie erstellen
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
                }
            } catch (err) { alert(err.message); }
        });
    }

    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);
}

/* ==========================================
   TOUREN LOGIK & MAP
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
   GPX UPLOAD LOGIK
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

    if (trkpts.length === 0) return alert("Fehler: Keine Wegpunkte in GPX.");

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
    if (!currentUser) return alert("Bitte einloggen.");
    if (!tempGpxData) return alert("Bitte erst eine GPX Datei wählen.");

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
            alert("Tour erfolgreich hochgeladen!");
        }
    } catch (err) { alert("Fehler beim Speichern: " + err.message); }
}

/* ==========================================
   LÖSCH-FUNKTION (MIT DEBUGGING)
   ========================================== */
window.deleteItem = async (type, id, partitionKey, parentId = null, commentText = null, commentUser = null) => {
    if (!confirm("Wirklich unwiderruflich löschen?")) return;

    // Payload für die Konsole (damit du siehst, was gesendet wird)
    const payload = { type, id, partitionKey, parentId, commentText, commentUser };
    console.log("Sende deleteItem Request:", payload);

    try {
        const response = await fetch(`${API_URL}/deleteItem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("Erfolgreich gelöscht!");
            // UI aktualisieren
            if (type === 'tour') { loadToursFromServer(); }
            else if (type === 'post' || type === 'comment') { window.loadFeed(); }
            else if (type === 'thread' || type === 'reply') { 
                if(type==='thread') renderForumSubCategory(currentCategoryId); 
                else renderThreadDetail(parentId, currentForumTopic, currentCategoryId);
            }
            else if (type === 'category') {
                renderForumSubCategory(currentCategoryId);
            }
        } else {
            // HIER IST DIE ÄNDERUNG: Wir lesen den Fehlertext vom Server!
            const errorText = await response.text();
            console.error("Lösch-Fehler Details:", errorText);
            alert(`Fehler beim Löschen (400)!\n\nGrund: ${errorText}\n\n(Prüfe die Konsole für Details)`);
        }
    } catch (e) { 
        console.error(e); 
        alert("Netzwerk- oder Server-Fehler beim Löschen."); 
    }
};

// Hilfsfunktion: Button HTML generieren - KORRIGIERT FÜR NULL WERTE
function getDeleteBtn(type, id, partitionKey, parentId=null, text=null, user=null) {
    if (currentRole !== 'admin') return "";

    // Hilfsfunktion: Setzt Anführungszeichen nur wenn nötig, sonst 'null' ohne Anführungszeichen
    const formatArg = (val) => {
        if (val === null || val === undefined) return 'null';
        // Strings escapen (für onclick)
        return `'${val.toString().replace(/'/g, "\\'").replace(/\n/g, " ")}'`;
    };

    const argType = formatArg(type);
    const argId = formatArg(id);
    const argPKey = formatArg(partitionKey);
    const argParent = formatArg(parentId); // HIER war der Fehler (war früher '${parentId}')
    const argText = formatArg(text);
    const argUser = formatArg(user);

    return `<button class="btn btn-sm btn-outline-danger border-0 ms-2" 
            onclick="event.stopPropagation(); deleteItem(${argType}, ${argId}, ${argPKey}, ${argParent}, ${argText}, ${argUser})">
            🗑️</button>`;
}

window.downloadGPX = (tourId) => {
    const tour = toursData.find(t => t.id === tourId);
    if (!tour || !tour.routeGeometry) return alert("Keine Routendaten.");
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
        
        // Versuchen, eine gültige ID zu finden. Falls die API "rowKey" verwendet, nehmen wir diesen.
        const safeId = topic.id || topic.rowKey || topic.title;
        
        let deleteBtn = "";
        if (currentRole === 'admin') {
             // Wichtig: 'catId' ist hier der PartitionKey (z.B. "bikes")
             deleteBtn = getDeleteBtn('category', safeId, catId, null, topic.title);
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

    container.innerHTML = `
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
            container.innerHTML += `
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
 };   

window.sendReply = async function(threadId, topic, catId) {
    const text = document.getElementById('replyText').value;
    if (!text.trim()) return alert("Bitte Text eingeben!");
    try {
        const response = await fetch(`${API_URL}/addReply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: threadId, topic, text, user: currentUser.displayName || "Unbekannt" })
        });
        if (response.ok) renderThreadDetail(threadId, topic, catId);
    } catch (err) { alert(err.message); }
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

// POST ERSTELLEN
window.createPost = async () => {
    if (!auth.currentUser) { return alert("Bitte melde dich erst an, um zu posten!"); }
    const textInput = document.getElementById('postInputText');
    const fileInput = document.getElementById('postInputFile');
    const submitBtn = document.querySelector('button[onclick="window.createPost()"]');

    if (!textInput.value.trim() && fileInput.files.length === 0) { return alert("Bitte schreibe etwas."); }

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
            alert("Beitrag veröffentlicht!");
            textInput.value = ""; fileInput.value = "";
            loadFeed();
        } else {
            console.error("Server Fehler:", await response.text());
        }
    } catch (error) { console.error("Netzwerkfehler:", error); } 
    finally { submitBtn.innerText = oldText; submitBtn.disabled = false; }
};

/* ==========================================
   FEED / POSTS LADEN
   ========================================== */
window.loadFeed = async function() {
    const container = document.getElementById('feed-posts');
    if (!container) return; 

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';

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
            
            let mediaHtml = "";
            if (post.mediaUrl) {
                if (post.mediaType === 'video') mediaHtml = `<video src="${post.mediaUrl}" controls class="img-fluid rounded mt-2 w-100" style="max-height:500px;"></video>`;
                else mediaHtml = `<img src="${post.mediaUrl}" class="img-fluid rounded mt-2 w-100" style="max-height:500px; object-fit:cover;" loading="lazy">`;
            }

            let commentsHtml = '';
            comments.forEach(c => {
                commentsHtml += `
                <div class="comment-item">
                    <div class="comment-bubble">
                        <span class="comment-author">${c.user}</span>
                        ${c.text}
                        <div class="text-end">${getDeleteBtn('comment', null, post.userId, postId, c.text, c.user)}</div>
                    </div>
                </div>`;
            });

            const html = `
            <div class="card mb-4 border-0 shadow-sm">
                <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center pt-3">
                    <div class="d-flex align-items-center">
                        <div style="width:40px; height:40px; background:#f0f2f5; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:10px; font-size:1.2rem;">👤</div>
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

    } catch (error) { console.error(error); }
};

window.toggleLike = async (postId) => {
    if (!auth.currentUser) return alert("Bitte erst einloggen!");
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
    if (!auth.currentUser) return alert("Bitte erst einloggen!");
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
   PROFIL & USER INTERACTION (BEREINIGT)
   ========================================== */

window.openUserProfile = (userId, userName) => {
    console.log("Öffne Profil für:", userId, userName);
    viewingUserProfile = { 
        uid: userId, 
        displayName: userName, 
        isMe: (currentUser && currentUser.displayName === userName) 
    };
    navigateTo('profile');
};

window.renderProfilePage = async () => {
    const container = document.getElementById('page-profile');
    if (!container) return;
    
    // 1. Fallback prüfen
    if (!viewingUserProfile && currentUser) {
        viewingUserProfile = { uid: currentUser.uid, displayName: currentUser.displayName, isMe: true };
    } else if (!viewingUserProfile) {
        container.innerHTML = '<div class="p-5 text-center">Bitte erst einloggen oder Nutzer wählen.</div>';
        return;
    }

    // 2. DOM Elemente finden
    const nameEl = document.getElementById('profile-name');
    const bioEl = document.getElementById('profile-bio');
    const actionArea = document.getElementById('profile-actions');
    const statsArea = document.getElementById('profile-stats-content');
    
    // 3. Bild setzen (Check ob Element existiert)
    const imgEl = document.getElementById('profile-img');
    if(imgEl) {
        imgEl.src = `https://ui-avatars.com/api/?name=${viewingUserProfile.displayName}&background=random&size=128`;
    }

    // 4. Texte setzen
    if (nameEl) nameEl.innerText = viewingUserProfile.displayName;
    if (bioEl) bioEl.innerText = viewingUserProfile.isMe ? currentUser.email : "Community Mitglied";

    // 5. Buttons
    if (actionArea) {
        if (viewingUserProfile.isMe) {
            actionArea.innerHTML = `<button class="btn btn-outline-secondary btn-sm" onclick="alert('Bearbeiten kommt bald')">✏️ Profil bearbeiten</button>`;
        } else {
            actionArea.innerHTML = `
                <button class="btn btn-danger btn-sm me-2" onclick="alert('Freundschaftsanfrage gesendet!')">🤝 Freund+</button>
                <button class="btn btn-dark btn-sm" onclick="alert('Chat folgt bald')">💬 Nachricht</button>
            `;
        }
    }

    // 6. Inhalte laden
    if (statsArea) {
        statsArea.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-danger"></div></div>';
        
        const targetName = viewingUserProfile.displayName;
        const myTours = toursData.filter(t => t.user === targetName);
        const myPosts = allPostsCache.filter(p => p.user === targetName);

        let html = `<div class="d-flex gap-3 mb-4 justify-content-center text-center">
                        <div class="bg-light p-2 rounded px-3"><b>${myTours.length}</b><br><small>Touren</small></div>
                        <div class="bg-light p-2 rounded px-3"><b>${myPosts.length}</b><br><small>Beiträge</small></div>
                    </div>`;

        if (myTours.length > 0) {
            html += `<h6 class="fw-bold mt-3">🏍️ Touren</h6><div class="list-group mb-3">`;
            myTours.forEach(t => {
                html += `<a href="#" onclick="selectTour('${t.id}'); navigateTo('tours');" class="list-group-item list-group-item-action border-0 border-bottom">${t.title} <small class="text-muted">(${t.km} km)</small></a>`;
            });
            html += `</div>`;
        }
        
        if (myPosts.length > 0) {
             html += `<h6 class="fw-bold mt-3">📸 Beiträge</h6><div class="list-group mb-3">`;
             myPosts.forEach(p => {
                 html += `<div class="list-group-item border-0 border-bottom">${p.content || "Medien Inhalt"}</div>`;
             });
             html += `</div>`;
        }

        if(myTours.length === 0 && myPosts.length === 0) {
            html += `<p class="text-center text-muted">Keine öffentlichen Aktivitäten.</p>`;
        }

        statsArea.innerHTML = html;
    }
};