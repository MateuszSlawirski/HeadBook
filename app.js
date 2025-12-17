/* ==========================================
   KONFIGURATION & GLOBALE VARIABLEN
   ========================================== */

// Die Adresse deines Backends. 
// Da Frontend und Backend auf derselben Azure-Domain liegen, reicht "/api".
const API_URL = "/api/tours";

// Hier speichern wir die Daten, sobald sie vom Server kommen
let toursData = []; 

// Karten-Variablen
let map = null;
let markers = []; 

/* ==========================================
   INITIALISIERUNG (START)
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App startet...");
    
    // 1. Daten vom Server holen
    loadToursFromServer();

    // 2. Navigation aktiv setzen (Optik)
    setActiveNavLink();
});

/* ==========================================
   DATEN LADEN (BACKEND VERBINDUNG)
   ========================================== */

async function loadToursFromServer() {
    const listContainer = document.getElementById('tours-container');
    
    // Lade-Animation anzeigen
    if(listContainer) {
        listContainer.innerHTML = `
            <div class="text-center mt-5">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-2 text-muted">Lade Touren aus der Cloud...</p>
            </div>`;
    }

    try {
        // DER API AUFRUF
        const response = await fetch(API_URL);
        
        if (!response.ok) throw new Error(`Server antwortete mit Fehler: ${response.status}`);
        
        // Daten in unsere Variable speichern
        toursData = await response.json();
        console.log("✅ Daten erfolgreich geladen:", toursData);

        // Jetzt alles starten, was Daten braucht
        initMap();      // Karte vorbereiten
        initFilters();  // Filter-Menüs füllen
        filterTours();  // Liste und Marker anzeigen

    } catch (error) {
        console.error("❌ Fehler beim Laden:", error);
        if(listContainer) {
            listContainer.innerHTML = `
                <div class="text-center text-danger mt-5">
                    <h5>Verbindung fehlgeschlagen</h5>
                    <p>Konnte keine Touren laden. Läuft das Backend?</p>
                    <small>${error.message}</small>
                </div>`;
        }
    }
}

/* ==========================================
   KARTE & ANZEIGE (LEAFLET)
   ========================================== */

function initMap() {
    // Verhindern, dass wir die Karte doppelt laden
    if (map) return; 

    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    // Karte erstellen (Zentrum Deutschland)
    map = L.map('map').setView([51.1657, 10.4515], 6); 

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);
}

function renderTours(data) {
    const listContainer = document.getElementById('tours-container');
    if(!listContainer) return;

    listContainer.innerHTML = '';
    
    // Alte Marker entfernen
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    if(data.length === 0) {
        listContainer.innerHTML = '<p class="text-center text-muted mt-5">Keine Touren gefunden.</p>';
        return;
    }

    data.forEach(tour => {
        // 1. Marker auf Karte setzen
        if(tour.coords && tour.coords.length === 2) {
            const marker = L.marker(tour.coords).addTo(map);
            marker.bindPopup(`<b>${tour.title}</b><br>⭐ ${tour.rating || 0} (${tour.votes || 0})`);
            markers.push(marker);
            
            // Klick auf Marker öffnet Popup
            marker.on('click', () => {
                map.flyTo(tour.coords, 10);
            });
        }

        // 2. Karte in der Liste erstellen
        const card = document.createElement('div');
        card.className = 'mini-tour-card';
        card.innerHTML = `
            <div class="d-flex justify-content-between">
                <h5 class="fw-bold m-0">${tour.title}</h5>
                <div class="text-warning">
                    ${getStars(tour.rating)} 
                    <small class="text-muted">(${tour.votes || 0})</small>
                </div>
            </div>
            <div class="tour-subline text-muted small mb-2">
                ${tour.country} • ${tour.state}
            </div>
            <div class="tour-meta d-flex gap-3 small text-secondary">
                <span>📏 ${tour.km} km</span>
                <span>⏱️ ${tour.time} h</span>
            </div>
            <p class="mt-2 mb-0 small text-muted">${tour.desc || "Keine Beschreibung"}</p>
        `;
        
        // Klick auf Karte zoomt zum Marker
        card.addEventListener('click', () => {
            if(tour.coords) {
                map.flyTo(tour.coords, 10);
            }
        });

        listContainer.appendChild(card);
    });
}

function getStars(rating) {
    if(!rating) rating = 0;
    let stars = '';
    for(let i=1; i<=5; i++) {
        stars += i <= Math.round(rating) ? '★' : '☆';
    }
    return stars;
}

/* ==========================================
   NEUE TOUR HINZUFÜGEN (POST REQUEST)
   ========================================== */

const addTourForm = document.getElementById('addTourForm');

if(addTourForm) {
    addTourForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Button sperren (Ladezustand)
        const submitBtn = addTourForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = "Speichere in Cloud...";

        // Daten sammeln
        // Zufalls-Koordinaten für Demo (da wir keine Klick-Map haben)
        const lat = 47 + Math.random() * 5; 
        const lng = 7 + Math.random() * 5;

        const newTourObj = {
            title: document.getElementById('newTitle').value,
            category: document.getElementById('newRegion').value,
            country: document.getElementById('newCountry').value,
            state: document.getElementById('newState').value || "Community",
            km: document.getElementById('newKm').value,
            time: document.getElementById('newTime').value,
            curves: "Unbekannt",
            desc: document.getElementById('newDesc').value,
            coords: [lat, lng]
        };

        try {
            // POST an Azure Backend
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newTourObj)
            });

            if(response.ok) {
                const savedTour = await response.json();
                
                // Lokal hinzufügen für sofortiges Feedback
                toursData.unshift(savedTour);
                
                // Modal schließen
                const modalEl = document.getElementById('addTourModal');
                if(modalEl && window.bootstrap) {
                     const modal = bootstrap.Modal.getInstance(modalEl);
                     if(modal) modal.hide();
                }

                addTourForm.reset();
                alert("✅ Erfolgreich gespeichert!");
                
                // Liste aktualisieren
                filterTours();

            } else {
                alert("❌ Fehler: Server hat nicht gespeichert.");
            }

        } catch (err) {
            console.error(err);
            alert("Fehler: Server nicht erreichbar.");
        } finally {
            // Button wieder freigeben
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    });
}

/* ==========================================
   FILTER LOGIK
   ========================================== */

function initFilters() {
    const categorySelect = document.getElementById('filter-category');
    if(!categorySelect) return;

    // Alle Kategorien aus den geladenen Daten sammeln
    const categories = [...new Set(toursData.map(t => t.category))].sort();
    
    categorySelect.innerHTML = '<option value="all">Bitte wählen...</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        categorySelect.appendChild(opt);
    });
}

// Wenn Region geändert wird
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

// Wenn Land geändert wird
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

// Haupt-Filter Funktion
function filterTours() {
    const searchInput = document.getElementById('search-input');
    const catSelect = document.getElementById('filter-category');
    const countrySelect = document.getElementById('filter-country');
    const stateSelect = document.getElementById('filter-state');
    
    // Abbruch wenn Elemente nicht da sind
    if(!catSelect) return;

    const listContainer = document.getElementById('tours-container');
    const sCat = catSelect.value;
    
    // Wenn keine Region gewählt: Hinweis zeigen
    if (sCat === 'all') {
        listContainer.innerHTML = `
            <div class="text-center mt-5 p-4 bg-light rounded">
                <h5>👋 Willkommen!</h5>
                <p class="text-muted">Bitte wähle links eine <b>Region</b> (z.B. Europa), um Touren zu laden.</p>
            </div>`;
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        return; 
    }

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const sCountry = countrySelect.value;
    const sState = stateSelect.value;

    // Filtern
    const filtered = toursData.filter(tour => {
        const catMatch = (tour.category === sCat); 
        
        let countryMatch = true;
        if (sCountry !== 'all') countryMatch = (tour.country === sCountry);

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

function resetFilters() {
    document.getElementById('search-input').value = "";
    document.getElementById('filter-category').value = 'all';
    onCategoryChange(); // Setzt alles zurück
}

/* ==========================================
   HILFSFUNKTIONEN (Navbar etc.)
   ========================================== */

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