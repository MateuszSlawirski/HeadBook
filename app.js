/* --- KONFIGURATION --- */
// Automatische Erkennung: Lokal nutzen wir Localhost, Online nutzen wir Azure
const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
    ? "http://localhost:7071/api"  // Falls du die API lokal startest (optional)
    : "/api";                      // Wenn die Seite online ist (Azure)

let toursData = []; 

/* --- INIT --- */
document.addEventListener('DOMContentLoaded', () => {
    console.log("App startet... Backend URL:", API_BASE);
    loadTours();
});

/* --- DATEN LADEN --- */
async function loadTours() {
    const listContainer = document.getElementById('tours-container');
    if(listContainer) listContainer.innerHTML = '<div class="text-center mt-5">⏳ Lade Touren aus der Cloud...</div>';

    try {
        const response = await fetch(`${API_BASE}/tours`);
        if (!response.ok) throw new Error(`HTTP Fehler: ${response.status}`);
        
        toursData = await response.json();
        console.log("Daten empfangen:", toursData);
        
        if(typeof initTours === 'function') initTours(); // Karte starten
        if(typeof filterTours === 'function') filterTours(); // Liste anzeigen

    } catch (error) {
        console.error("Fehler:", error);
        if(listContainer) listContainer.innerHTML = `
            <div class="text-center text-danger mt-5">
                <p>Verbindung zum Backend fehlgeschlagen.</p>
                <small>${error.message}</small>
            </div>`;
    }
}

/* --- NEUE TOUR SPEICHERN --- */
const addTourForm = document.getElementById('addTourForm');
if(addTourForm) {
    addTourForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = addTourForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerText = "Speichere...";

        const newTour = {
            title: document.getElementById('newTitle').value,
            category: document.getElementById('newRegion').value,
            country: document.getElementById('newCountry').value,
            state: document.getElementById('newState').value || "Unbekannt",
            km: document.getElementById('newKm').value,
            time: document.getElementById('newTime').value,
            desc: document.getElementById('newDesc').value,
            coords: [48 + Math.random()*2, 10 + Math.random()*2] // Zufallsposition für Demo
        };

        try {
            const resp = await fetch(`${API_BASE}/tours`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTour)
            });

            if(resp.ok) {
                const savedTour = await resp.json();
                toursData.unshift(savedTour);
                
                // Modal schließen (Bootstrap)
                const modalEl = document.getElementById('addTourModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                modal.hide();
                
                addTourForm.reset();
                if(typeof filterTours === 'function') filterTours();
                alert("Erfolg! Tour in der Cloud gespeichert.");
            } else {
                alert("Fehler beim Speichern.");
            }
        } catch (err) {
            console.error(err);
            alert("Server-Fehler: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Veröffentlichen";
        }
    });
}

// Hierunter folgen deine alten Funktionen wie initTours(), filterTours(), rateTour()...
// Kopiere deine alten Hilfsfunktionen (Map, Filter) unbedingt wieder hier drunter! 
// Falls du sie nicht mehr hast, sag Bescheid, dann geb ich dir den vollen Code.

// Posts für Home/Community
const posts = [
    { id: 1, author: "Lisa Motorrad", avatar: "LM", time: "vor 2 Std", content: "Super Tour im Schwarzwald heute gemacht! Das Wetter war perfekt.", likes: 45, comments: 12 },
    { id: 2, author: "Tom Rider", avatar: "TR", time: "Gestern", content: "Hat jemand Tipps für neue Reifen auf der MT-09?", likes: 8, comments: 24 }
];

/* --- MAP & TOURS LOGIK --- */
let map = null;
let markers = []; 

function initTours() {
    const mapContainer = document.getElementById('map');
    const listContainer = document.getElementById('tours-container');
    
    if (!mapContainer || !listContainer) return; 

    if (!map) {
        map = L.map('map').setView([51.1657, 10.4515], 6); 

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(map);
        
    }
    filterTours();
}

/* --- RENDER TOURS --- */
function renderTours(data) {
    const listContainer = document.getElementById('tours-container');
    listContainer.innerHTML = '';
    
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    data.forEach(tour => {
        const marker = L.marker(tour.coords).addTo(map);
        marker.bindPopup(`<b>${tour.title}</b><br>⭐ ${tour.rating} (${tour.votes})`);
        markers.push(marker);
        
        let starsHTML = '';
        for(let i=1; i<=5; i++) {
            let starClass = i <= Math.round(tour.rating) ? 'star-filled' : 'star-empty';
            starsHTML += `<span class="${starClass}" onclick="rateTour(${tour.id}, ${i}, event)">★</span>`;
        }

        const card = document.createElement('div');
        card.className = 'mini-tour-card';
        card.innerHTML = `
            <div class="d-flex justify-content-between">
                <h5 style="margin:0">${tour.title}</h5>
                <div class="rating-box" title="Klicken zum Bewerten">${starsHTML} <small class="text-muted">(${tour.votes})</small></div>
            </div>
            <div class="tour-subline">${tour.country} • ${tour.state}</div>
            <div class="tour-meta">
                <span>📏 ${tour.km} km</span>
                <span>⏱️ ${tour.time} h</span>
                <span>〰️ ${tour.curves}</span>
            </div>
            <p style="font-size:13px; color:#666; margin-top:5px;">${tour.desc}</p>
        `;
        
        card.addEventListener('click', (e) => {
            if(e.target.classList.contains('star-filled') || e.target.classList.contains('star-empty')) return;
            map.flyTo(tour.coords, 10);
            marker.openPopup();
        });
        listContainer.appendChild(card);
    });
}

/* --- RENDER POSTS (Für Home Feed) --- */
function loadPosts() {
    const feedContainer = document.getElementById('feed-posts');
    if (!feedContainer) return; 

    feedContainer.innerHTML = '';
    posts.forEach(post => {
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
            <div class="post-header">
                <div class="post-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:bold;color:#666;">${post.avatar}</div>
                <div>
                    <div style="font-weight:bold;">${post.author}</div>
                    <div style="font-size:12px;color:gray;">${post.time}</div>
                </div>
            </div>
            <div class="post-content">${post.content}</div>
            <div class="post-actions">
                <span>👍 ${post.likes} Likes</span>
                <span>💬 ${post.comments} Kommentare</span>
            </div>
        `;
        feedContainer.appendChild(div);
    });
}

/* --- HELPER: Label für Slider --- */
function updateKmLabel() {
    const val = document.getElementById('kmRange').value;
    if(document.getElementById('kmValue')) {
        document.getElementById('kmValue').innerText = val;
    }
}

/* =========================================
   FILTER LOGIK (KASKADIEREND & CLEAN)
   ========================================= */

// 1. Initialisierung: Nur Kategorien laden
function initFilters() {
    const categorySelect = document.getElementById('filter-category');
    if(!categorySelect) return;

    const categories = [...new Set(toursData.map(t => t.category))].sort();
    
    // Wichtig: Startwert ist "all" (Bitte wählen...)
    categorySelect.innerHTML = '<option value="all">Bitte wählen...</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        categorySelect.appendChild(opt);
    });
}

// 2. Wenn Region geändert wird
function onCategoryChange() {
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    const selectedCat = catSelect.value;

    // Reset der unteren Ebenen
    countrySelect.innerHTML = '<option value="all">Alle Länder</option>';
    stateSelect.innerHTML = '<option value="all">Alle Bundesländer</option>';
    stateSelect.disabled = true; 

    if (selectedCat === 'all') {
        countrySelect.disabled = true;
        countrySelect.innerHTML = '<option value="all">--</option>';
        stateSelect.innerHTML = '<option value="all">--</option>';
        filterTours(); 
        return;
    }

    countrySelect.disabled = false;
    
    const matchingTours = toursData.filter(t => t.category === selectedCat);
    const uniqueCountries = [...new Set(matchingTours.map(t => t.country))].sort();

    uniqueCountries.forEach(country => {
        const opt = document.createElement('option');
        opt.value = country;
        opt.innerText = country;
        countrySelect.appendChild(opt);
    });

    filterTours(); 
}

// 3. Wenn Land geändert wird
function onCountryChange() {
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    const selectedCountry = countrySelect.value;

    stateSelect.innerHTML = '<option value="all">Alle Bundesländer</option>';

    if (selectedCountry === 'all') {
        stateSelect.disabled = true;
        stateSelect.innerHTML = '<option value="all">--</option>';
        filterTours();
        return;
    }

    stateSelect.disabled = false;

    const matchingTours = toursData.filter(t => t.country === selectedCountry);
    const uniqueStates = [...new Set(matchingTours.map(t => t.state))].sort();

    uniqueStates.forEach(state => {
        const opt = document.createElement('option');
        opt.value = state;
        opt.innerText = state;
        stateSelect.appendChild(opt);
    });

    filterTours(); 
}

// 4. HAUPT-FILTER (Slider Logik entfernt)
function filterTours() {
    const searchInput = document.getElementById('search-input');
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    const listContainer = document.getElementById('tours-container');

    if(!catSelect) return;

    const sCat = catSelect.value;
    
    // --- NEU: ABBRUCH WENN KEINE REGION GEWÄHLT ---
    if (sCat === 'all') {
        listContainer.innerHTML = '<p class="text-center text-muted mt-5">👋 Bitte wähle zuerst eine Region links im Filter.</p>';
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        return; 
    }

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const sCountry = countrySelect.value;
    const sState = stateSelect.value;

    const filtered = toursData.filter(tour => {
        const catMatch = (tour.category === sCat); 
        
        let countryMatch = true;
        if (sCountry !== 'all') {
             countryMatch = (tour.country === sCountry);
        }

        let stateMatch = true;
        if (sCountry !== 'all' && sState !== 'all' && !stateSelect.disabled) {
            stateMatch = (tour.state === sState);
        }

        const searchMatch = tour.title.toLowerCase().includes(searchTerm) || 
                            (tour.desc || "").toLowerCase().includes(searchTerm);
        
        return catMatch && countryMatch && stateMatch && searchMatch;
    });

    renderTours(filtered);
}

// 5. Reset
function resetFilters() {
    document.getElementById('search-input').value = "";
    
    document.querySelectorAll('.filter-cb').forEach(cb => cb.checked = false);
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');

    catSelect.value = 'all';
    
    countrySelect.innerHTML = '<option value="all">--</option>';
    countrySelect.disabled = true;
    
    stateSelect.innerHTML = '<option value="all">--</option>';
    stateSelect.disabled = true;

    filterTours(); 
}

/* --- BEWERTUNGEN --- */
function rateTour(id, starValue, event) {
    if(event) event.stopPropagation(); 
    
    const tour = toursData.find(t => t.id === id);
    if(tour) {
        tour.rating = ((tour.rating * tour.votes) + starValue) / (tour.votes + 1);
        tour.rating = Math.round(tour.rating * 10) / 10; 
        tour.votes++;
        
        alert(`Danke! Du hast "${tour.title}" mit ${starValue} Sternen bewertet.`);
        filterTours(); 
    }
}

/* --- NEUE TOUR (Add Logic) --- */
const addTourForm = document.getElementById('addTourForm');
if(addTourForm) {
    addTourForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const lat = 47 + Math.random() * 6; 
        const lng = 7 + Math.random() * 6;

        const newTour = {
            id: Date.now(),
            title: document.getElementById('newTitle').value,
            category: document.getElementById('newRegion').value,
            country: document.getElementById('newCountry').value,
            state: document.getElementById('newState').value || "Unbekannt",
            km: document.getElementById('newKm').value,
            time: document.getElementById('newTime').value,
            curves: "Unbekannt",
            desc: document.getElementById('newDesc').value,
            coords: [lat, lng],
            rating: 0,
            votes: 0
        };

        toursData.unshift(newTour); 
        
        const modalEl = document.getElementById('addTourModal');
        if(modalEl && window.bootstrap) {
             const modal = bootstrap.Modal.getInstance(modalEl);
             if(modal) modal.hide();
        }

        addTourForm.reset();
        alert("Route erfolgreich hinzugefügt!");
        
        initFilters(); 
        filterTours(); 
    });
}

/* --- INIT --- */
document.addEventListener('DOMContentLoaded', () => {
    if(typeof initTours === 'function') initTours();
    if(typeof loadPosts === 'function') loadPosts();

    // Funktion zur Markierung des aktiven Links in der Navbar
    function setActiveNavLink() {
        const navLinks = document.querySelectorAll('.nav-link');  
        const currentPage = window.location.pathname.toLowerCase();  

        navLinks.forEach(link => {
            link.classList.remove('active');  
            if (currentPage.includes(link.getAttribute('href').toLowerCase())) {
                link.classList.add('active');  
            }
        });
    }

    // Setze den aktiven Link beim Laden der Seite
    setActiveNavLink();
    
    // NEU: Startet die Kaskaden-Filter
    if(typeof initFilters === 'function') initFilters();
});
