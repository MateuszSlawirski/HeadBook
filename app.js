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
let currentForumTopic = null; 

/* ==========================================
   APP START
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 SPA startet...");

    initMap();

    onAuthStateChanged(auth, async (user) => {
        currentUser = user; 
        if (user) {
            updateUI(); 
            await syncUserWithBackend(user); 
        } else {
            currentRole = "guest";
            if (getActivePage() === 'profile') {
                navigateTo('home');
            }
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
   ROUTER
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

        if (pageId === 'tours' && map) {
            setTimeout(() => { map.invalidateSize(); }, 100);
        }
    }
}

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}
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
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        secureLinks.forEach(link => link.classList.add('d-none'));
        if(addTourBtn) addTourBtn.style.display = 'none';
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
    // 1. LOGOUT
    const btnLogout = document.getElementById('logout-btn');
    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await signOut(auth);
            navigateTo('home');
        });
    }

    // 2. AUTH MODAL
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

    // 3. AUTH SUBMIT
    if(authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const isRegisterMode = nameContainer && nameContainer.style.display === 'block';
            if (isRegisterMode) handleRegister(); else handleLogin(e);
        });
    }

    // 4. TOUR HINZUFÜGEN
    const addTourForm = document.getElementById('addTourForm');
    if(addTourForm) addTourForm.addEventListener('submit', handleAddTour);

    // 5. NEUER FORUM BEITRAG
    const createThreadForm = document.getElementById('createThreadForm');
    if (createThreadForm) {
        createThreadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!currentUser) {
                alert("Bitte logge dich erst ein!");
                return;
            }

            const title = document.getElementById('threadTitle').value;
            const text = document.getElementById('threadText').value;
            const btn = e.target.querySelector('button[type="submit"]');

            btn.disabled = true;
            btn.innerText = "Sende...";

            try {
                const newPost = {
                    topic: currentForumTopic,
                    title: title,
                    text: text,
                    user: currentUser.displayName || "Unbekannt"
                };

                const response = await fetch(`${API_URL}/threads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newPost)
                });

                if (response.ok) {
                    const modalEl = document.getElementById('createThreadModal');
                    bootstrap.Modal.getInstance(modalEl).hide();
                    e.target.reset();
                    
                    await loadForumData(); 
                    renderForumThreads(currentForumTopic);
                } else {
                    throw new Error("Fehler beim Speichern");
                }
            } catch (err) {
                alert(err.message);
            } finally {
                btn.disabled = false;
                btn.innerText = "Veröffentlichen";
            }
        });
    }
}

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

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
    const selectedCountry = countrySelect.value;

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
   HELPER: EMOJIS EINFÜGEN
   ========================================== */
window.insertEmoji = function(emoji, targetId = 'threadText') {
    const textarea = document.getElementById(targetId);
    if (textarea) {
        textarea.value += emoji;
        textarea.focus();
    }
};

/* ==========================================
   FORUM LOGIK
   ========================================== */

let allForumData = []; 
let allThreadsCache = []; 
let currentCategoryId = null; 

async function loadForumData() {
    const container = document.getElementById('forum-container');
    if(!container) return;
    
    if(allForumData.length === 0) {
        container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';
    }
    
    try {
        const catResponse = await fetch(`${API_URL}/forum`);
        if (!catResponse.ok) throw new Error("Kategorie-Fehler");
        allForumData = await catResponse.json();

        const threadResponse = await fetch(`${API_URL}/threads`); 
        if (threadResponse.ok) {
            allThreadsCache = await threadResponse.json();
        }

        if (!currentCategoryId && !currentForumTopic) {
            renderForumHome();
        }
    } catch (error) {
        console.error(error);
        if(allForumData.length === 0) {
            container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden.</div>';
        }
    }
}

// HELPER: Neuesten Thread Vorschau-Box bauen
// NEU: showTopicName Parameter für die "in Kategorie"-Anzeige
function getLatestPostHtml(filterFn, showTopicName = false) {
    const relevantThreads = allThreadsCache.filter(filterFn);
    
    relevantThreads.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt) : new Date(a.date);
        const timeB = b.createdAt ? new Date(b.createdAt) : new Date(b.date);
        return timeB - timeA; 
    });

    if (relevantThreads.length === 0) {
        return `
            <div class="p-3 bg-light rounded text-center text-muted border border-dashed">
                <small>Noch keine Beiträge</small>
            </div>`;
    }

    const last = relevantThreads[0];
    
    // HIER IST DIE ÄNDERUNG (Kursiv, klein, darunter):
    return `
        <div class="p-3 bg-light rounded border start-0 border-start-3 border-primary position-relative hover-bg-gray" 
             style="cursor: pointer; transition: background 0.2s;"
             onclick="event.stopPropagation(); renderThreadDetail('${last.id}', '${last.topic}')">
            
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge bg-primary bg-opacity-10 text-primary" style="font-size: 0.7em;">NEU</span>
                <small class="text-muted" style="font-size: 0.75em;">${last.date}</small>
            </div>
            
            <div class="fw-bold text-dark text-truncate mb-1" style="max-width: 100%;">
                ${last.title}
            </div>
            
            <div class="small text-muted">
                von <span class="fw-semibold text-dark">${last.user}</span>
                ${showTopicName ? `<div class="fst-italic text-secondary mt-1" style="font-size: 0.85em;">in ${last.topic}</div>` : ''}
            </div>
        </div>
    `;
}

// LEVEL 1: Hauptübersicht
window.renderForumHome = function() {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    if(!title) return;

    title.innerText = "Community Forum";
    subtitle.innerText = "Wähle einen Bereich.";
    
    backBtn.style.display = 'none';
    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    allForumData.forEach(cat => {
        const catTopicNames = cat.topics.map(t => t.title);
        // HIER: true übergeben, damit "in Kategorie" angezeigt wird
        const latestHtml = getLatestPostHtml((t) => catTopicNames.includes(t.topic), true);

        const item = document.createElement('div');
        item.className = 'card mb-3 shadow-sm border-0 forum-card';
        item.style.cursor = 'pointer';
        item.onclick = () => renderForumSubCategory(cat.id);

        item.innerHTML = `
            <div class="card-body p-4">
                <div class="row align-items-center">
                    <div class="col-md-7 mb-3 mb-md-0">
                        <div class="d-flex align-items-center mb-2">
                            <h2 class="fw-bold text-primary mb-0 me-2 fs-2">${cat.title}</h2>
                        </div>
                        <p class="text-secondary mb-0 small">
                            ${cat.desc || "Allgemeine Diskussionen und Themen."}
                        </p>
                    </div>

                    <div class="col-md-5">
                        ${latestHtml}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
};

// LEVEL 2: Unterkategorien
window.renderForumSubCategory = function(catId) {
    currentCategoryId = catId;
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
    backBtn.innerText = "⬅ Übersicht";
    backBtn.className = "btn btn-outline-secondary btn-sm mb-2"; 
    backBtn.onclick = renderForumHome;
    
    newThreadBtn.style.display = 'none';
    container.innerHTML = '';

    if (category.topics) {
        category.topics.forEach(topic => {
            // HIER: false übergeben, wir sind ja schon im Thema
            const latestHtml = getLatestPostHtml((t) => t.topic === topic.title, false);

            const item = document.createElement('div');
            item.className = 'card mb-3 shadow-sm border-0 forum-card';
            item.style.cursor = 'pointer';
            item.onclick = () => renderForumThreads(topic.title);

            item.innerHTML = `
                <div class="card-body p-3">
                    <div class="row align-items-center">
                        <div class="col-md-7 mb-3 mb-md-0">
                            <h5 class="fw-bold text-dark mb-1">${topic.title}</h5>
                            <p class="text-muted small mb-0">${topic.desc || ""}</p>
                        </div>
                        <div class="col-md-5">
                            ${latestHtml}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    }
};

// LEVEL 3: Liste der Threads
window.renderForumThreads = async function(topicName) {
    currentForumTopic = topicName; 
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    title.innerText = topicName;
    subtitle.innerText = "Lade Diskussionen...";
    
    let parentCatName = "Zurück";
    if (currentCategoryId) {
        const parentCat = allForumData.find(c => c.id === currentCategoryId);
        if(parentCat) parentCatName = "⬅ " + parentCat.title;
    }

    backBtn.style.display = 'inline-block';
    backBtn.innerText = parentCatName;
    backBtn.onclick = () => {
        if(currentCategoryId) renderForumSubCategory(currentCategoryId);
        else renderForumHome();
    };
    
    newThreadBtn.style.display = 'inline-block';
    newThreadBtn.onclick = () => {
        const topicInput = document.getElementById('threadTopicDisplay');
        if(topicInput) topicInput.value = currentForumTopic;
        const modalEl = document.getElementById('createThreadModal');
        if(modalEl) new bootstrap.Modal(modalEl).show();
    };
    
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';

    try {
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        if (!response.ok) throw new Error("Netzwerk Fehler");
        const threads = await response.json();

        container.innerHTML = ''; 
        if (threads.length === 0) {
            container.innerHTML = `
                <div class="p-5 text-center text-muted bg-light rounded">
                    <h3>📭</h3>
                    <h5>Noch nichts los hier.</h5>
                    <p>Sei der Erste, der etwas zu <b>${topicName}</b> schreibt!</p>
                </div>`;
            subtitle.innerText = "Keine Beiträge";
            return;
        }

        subtitle.innerText = `${threads.length} Diskussionen gefunden`;
        
        threads.sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt) : new Date(a.date);
            const timeB = b.createdAt ? new Date(b.createdAt) : new Date(b.date);
            return timeB - timeA;
        });

        threads.forEach(thread => {
            const item = document.createElement('div');
            item.className = 'list-group-item py-3 list-group-item-action border-start-0 border-end-0';
            item.style.cursor = 'pointer';
            item.onclick = () => renderThreadDetail(thread.id, thread.topic);

            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <h6 class="mb-1 fw-bold text-dark fs-5">${thread.title}</h6>
                    <span class="badge bg-secondary rounded-pill">${thread.replies || 0}</span>
                </div>
                <div class="small text-muted mt-1">
                    Gestartet von <b class="text-primary">${thread.user}</b> • ${thread.date || 'Heute'}
                </div>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Konnte Beiträge nicht laden.</div>';
    }
};

// LEVEL 4: Thread Detail (Beitrag lesen & antworten)
window.renderThreadDetail = async function(threadId, topicName) {
    const container = document.getElementById('forum-container');
    const title = document.getElementById('forum-title');
    const subtitle = document.getElementById('forum-subtitle');
    const backBtn = document.getElementById('forum-back-btn');
    const newThreadBtn = document.getElementById('new-thread-btn');

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div></div>';
    newThreadBtn.style.display = 'none'; 
    
    backBtn.style.display = 'inline-block';
    backBtn.innerText = "⬅ Zurück zum Thema";
    backBtn.onclick = () => renderForumThreads(topicName);

    try {
        const response = await fetch(`${API_URL}/threads?topic=${encodeURIComponent(topicName)}`);
        const threads = await response.json();
        const currentThread = threads.find(t => t.id === threadId);

        if (!currentThread) throw new Error("Beitrag nicht gefunden");

        title.innerText = currentThread.title;
        subtitle.innerText = `Gestartet von ${currentThread.user}`;

        container.innerHTML = '';

        // A) Original Post
        const originalPost = `
            <div class="card mb-4 border-0 shadow-sm">
                <div class="card-header bg-white border-bottom-0 pt-3 pb-0 d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 40px; height: 40px; font-weight:bold;">
                            ${currentThread.user.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h6 class="mb-0 fw-bold text-dark">${currentThread.user}</h6>
                            <small class="text-muted">Themenstarter</small>
                        </div>
                    </div>
                    <small class="text-muted">${currentThread.date}</small>
                </div>
                <div class="card-body">
                    <p class="card-text fs-5" style="white-space: pre-wrap; line-height: 1.6;">${currentThread.text}</p>
                </div>
            </div>
        `;
        container.innerHTML += originalPost;

        // B) Antworten
        if (currentThread.repliesList && currentThread.repliesList.length > 0) {
            container.innerHTML += `<h6 class="text-muted mb-3 ms-2">Antworten (${currentThread.repliesList.length})</h6>`;
            
            currentThread.repliesList.forEach(reply => {
                const replyHtml = `
                    <div class="card mb-3 border-0 shadow-sm ms-md-4" style="background-color: #fcfcfc;">
                        <div class="card-body py-3">
                            <div class="d-flex justify-content-between mb-2 border-bottom pb-2">
                                <strong class="text-dark">↪ ${reply.user}</strong>
                                <small class="text-muted">${reply.date}</small>
                            </div>
                            <p class="mb-0" style="white-space: pre-wrap;">${reply.text}</p>
                        </div>
                    </div>
                `;
                container.innerHTML += replyHtml;
            });
        }

        // C) Antwort-Formular
        if (currentUser) {
            const replyForm = `
                <div class="card mt-4 border-0 shadow-sm bg-light">
                    <div class="card-body">
                        <h6 class="fw-bold mb-3"><i class="bi bi-reply-fill"></i> Antwort schreiben</h6>
                        <textarea id="replyText" class="form-control mb-2 border-0 shadow-sm" rows="3" placeholder="Deine Meinung dazu..."></textarea>
                        
                        <div class="d-flex justify-content-between align-items-center mt-2">
                            <div>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('😀', 'replyText')">😀</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('😂', 'replyText')">😂</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('👍', 'replyText')">👍</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary border-0" onclick="insertEmoji('🏍️', 'replyText')">🏍️</button>
                            </div>
                            <button class="btn btn-primary px-4" onclick="sendReply('${currentThread.id}', '${currentThread.topic}')">
                                Senden ✈️
                            </button>
                        </div>
                    </div>
                </div>
            `;
            container.innerHTML += replyForm;
        } else {
            container.innerHTML += `
                <div class="alert alert-info mt-4 text-center shadow-sm border-0">
                    Willst du mitreden? Jetzt <a href="#" class="fw-bold" onclick="document.getElementById('btn-switch-mode').click()" data-bs-toggle="modal" data-bs-target="#authModal">einloggen</a>.
                </div>
            `;
        }

    } catch (error) {
        console.error(error);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Beitrags.</div>';
    }
};

// HELPER: Antwort absenden
window.sendReply = async function(threadId, topic) {
    const text = document.getElementById('replyText').value;
    if (!text.trim()) return alert("Bitte Text eingeben!");

    const btn = document.querySelector('button[onclick^="sendReply"]');
    if(btn) { btn.disabled = true; btn.innerText = "Sende..."; }

    try {
        const replyData = {
            id: threadId,
            topic: topic,
            text: text,
            user: currentUser.displayName || "Unbekannt"
        };

        const response = await fetch(`${API_URL}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(replyData)
        });

        if (response.ok) {
            renderThreadDetail(threadId, topic);
        } else {
            throw new Error("Fehler beim Senden");
        }
    } catch (err) {
        alert(err.message);
        if(btn) { btn.disabled = false; btn.innerText = "Senden ✈️"; }
    }
};

/* ==========================================
   GLOBAL EXPORTS
   ========================================== */
window.deleteTour = async (id, event) => {
    event.stopPropagation();
    if(!confirm("Löschen?")) return;
    alert("Gelöscht: " + id);
};

window.filterTours = filterTours;
window.onCategoryChange = onCategoryChange;
window.onCountryChange = onCountryChange;
window.resetFilters = resetFilters;