/* --- DATEN --- */
let toursData = [
    { 
        id: 1, title: "Schwarzwald Hochstraße", km: 65, time: "1:30", curves: "Extrem", 
        desc: "Der Klassiker in Baden-Württemberg. Tolle Aussicht, perfekter Asphalt.", 
        coords: [48.6000, 8.2000], category: "Europa", country: "Deutschland", state: "Baden-Württemberg", rating: 4.8, votes: 124
    },
    { 
        id: 2, title: "Elbufer Straße", km: 45, time: "1:00", curves: "Mittel", 
        desc: "Entspanntes Cruisen am Deich im Norden.", 
        coords: [53.5511, 9.9937], category: "Europa", country: "Deutschland", state: "Hamburg", rating: 4.2, votes: 56
    },
    { 
        id: 3, title: "Kyffhäuser 36", km: 12, time: "0:20", curves: "Legendär", 
        desc: "36 Kurven auf engstem Raum. Nichts für Anfänger!", 
        coords: [51.4116, 11.1039], category: "Europa", country: "Deutschland", state: "Thüringen", rating: 4.9, votes: 310
    }
];

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
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
    }
    renderTours(toursData); 
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

/* --- RENDER POSTS (NEU: Für Home Feed) --- */
function loadPosts() {
    const feedContainer = document.getElementById('feed-posts');
    if (!feedContainer) return; // Abbruch, wenn wir nicht auf Home sind

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

/* --- FILTER LOGIK (CHECKBOXEN & SUCHE) --- */
function filterTours() {
    // 1. Suche auslesen (Sicherheitscheck, falls Input fehlt)
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    // 2. Checkboxen auslesen
    // Sammelt alle Werte der angehakten Boxen in Arrays (z.B. ['Alpen', 'Harz'])
    const checkedRegions = Array.from(document.querySelectorAll('input[data-type="region"]:checked')).map(cb => cb.value);
    const checkedCountries = Array.from(document.querySelectorAll('input[data-type="country"]:checked')).map(cb => cb.value);
    const checkedStates = Array.from(document.querySelectorAll('input[data-type="state"]:checked')).map(cb => cb.value);

    // 3. Filtern
    const filtered = toursData.filter(tour => {
        // A. Kategorien prüfen (Leer = Alle, Sonst = Treffer in Liste)
        const regionMatch = checkedRegions.length === 0 || checkedRegions.includes(tour.category);
        const countryMatch = checkedCountries.length === 0 || checkedCountries.includes(tour.country);
        const stateMatch = checkedStates.length === 0 || checkedStates.includes(tour.state);

        // B. Suche prüfen (Titel ODER Beschreibung)
        // (tour.desc || "") verhindert Absturz bei fehlender Beschreibung
        const searchMatch = tour.title.toLowerCase().includes(searchTerm) || 
                            (tour.desc || "").toLowerCase().includes(searchTerm);

        // Nur wenn ALLES zutrifft, wird die Tour angezeigt
        return regionMatch && countryMatch && stateMatch && searchMatch;
    });

    renderTours(filtered);
}

// Funktion zum Zurücksetzen
function resetFilters() {
    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.value = "";
    
    // Wichtig: Deine Inputs im HTML müssen class="filter-cb" haben!
    document.querySelectorAll('.filter-cb').forEach(cb => cb.checked = false);
    
    filterTours(); // Ansicht aktualisieren
}

/* --- BEWERTUNGEN --- */
function rateTour(id, starValue, event) {
    if(event) event.stopPropagation(); // Verhindert Klick auf die Karte dahinter
    
    const tour = toursData.find(t => t.id === id);
    if(tour) {
        // Neuen Durchschnitt berechnen
        tour.rating = ((tour.rating * tour.votes) + starValue) / (tour.votes + 1);
        // Auf 1 Nachkommastelle runden
        tour.rating = Math.round(tour.rating * 10) / 10; 
        tour.votes++;
        
        alert(`Danke! Du hast "${tour.title}" mit ${starValue} Sternen bewertet.`);
        filterTours(); // UI neu rendern um Sterne zu aktualisieren
    }
}

/* --- NEUE TOUR (Add Logic) --- */
const addTourForm = document.getElementById('addTourForm');
if(addTourForm) {
    addTourForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Zufallskoordinaten für Demo-Zwecke (Mitteleuropa grob)
        const lat = 47 + Math.random() * 6; 
        const lng = 7 + Math.random() * 6;

        const newTour = {
            id: Date.now(), // Einfache einzigartige ID
            title: document.getElementById('newTitle').value,
            category: document.getElementById('newRegion').value,
            country: document.getElementById('newCountry').value,
            state: document.getElementById('newState').value || "Unbekannt",
            km: document.getElementById('newKm').value,
            time: document.getElementById('newTime').value,
            curves: "Unbekannt", // Da kein Input-Feld dafür da ist
            desc: document.getElementById('newDesc').value,
            coords: [lat, lng],
            rating: 0,
            votes: 0
        };

        toursData.unshift(newTour); // Fügt neue Tour OBEN hinzu
        
        // Bootstrap Modal schließen
        const modalEl = document.getElementById('addTourModal');
        if(modalEl && window.bootstrap) {
             const modal = bootstrap.Modal.getInstance(modalEl);
             if(modal) modal.hide();
        }

        addTourForm.reset();
        alert("Route erfolgreich hinzugefügt!");
        filterTours(); 
    });
}

/* --- INIT --- */
document.addEventListener('DOMContentLoaded', () => {
    // Prüfen ob Funktionen existieren, um Fehler zu vermeiden
    if(typeof initTours === 'function') initTours();
    if(typeof loadPosts === 'function') loadPosts();
});