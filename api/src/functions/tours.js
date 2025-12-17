const { app } = require('@azure/functions');

// Deine simulierten Daten
let toursDatabase = [
    { 
        id: 1, title: "Schwarzwald Hochstraße", km: 65, time: "1:30", curves: "Extrem", 
        desc: "Der Klassiker in BW. Tolle Aussicht.", 
        coords: [48.6000, 8.2000], category: "Europa", country: "Deutschland", state: "Baden-Württemberg", rating: 4.8, votes: 124
    },
    { 
        id: 2, title: "Elbufer Straße", km: 45, time: "1:00", curves: "Mittel", 
        desc: "Entspanntes Cruisen am Deich.", 
        coords: [53.5511, 9.9937], category: "Europa", country: "Deutschland", state: "Hamburg", rating: 4.2, votes: 56
    }
];

// Hier definieren wir die Funktion "tours"
app.http('tours', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        
        // A) DATEN ABRUFEN (GET)
        if (request.method === 'GET') {
            return { jsonBody: toursDatabase };
        } 
        
        // B) DATEN SPEICHERN (POST)
        else if (request.method === 'POST') {
            // In v4 holen wir die Daten so:
            const newTour = await request.json(); 

            // IDs und Standardwerte setzen
            newTour.id = Date.now();
            newTour.rating = 0;
            newTour.votes = 0;

            toursDatabase.unshift(newTour);

            return { status: 201, jsonBody: newTour };
        }
    }
});