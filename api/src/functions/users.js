const { app, output } = require('@azure/functions');

// Wir definieren nur noch den Ausgang (Output), um zu speichern
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'users',
    connection: 'CosmosDbConnectionString',
    createIfNotExists: true
});

app.http('user-sync', {
    methods: ['POST'],
    authLevel: 'anonymous',
    extraOutputs: [cosmosOutput], // Wir sagen der Funktion: Du darfst schreiben
    
    handler: async (request, context) => {
        try {
            // 1. Daten aus dem Frontend lesen
            const data = await request.json();
            const { uid, email, displayName } = data;

            if (!uid) {
                return { status: 400, body: "Fehler: Keine User-ID (uid) gesendet." };
            }

            // 2. Das User-Objekt vorbereiten
            // WICHTIG: 'id' muss in CosmosDB immer die uid sein!
            const userProfile = {
                id: uid,              // Das ist der Schlüssel in der Datenbank
                email: email,
                displayName: displayName || "Biker",
                lastLogin: new Date().toISOString() // Wir speichern, wann er zuletzt da war
            };

            // 3. Einfach speichern (überschreibt existierende Einträge = Update)
            context.extraOutputs.set(cosmosOutput, userProfile);

            return { status: 200, body: "User erfolgreich synchronisiert." };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            return { status: 500, body: "Interner Server Fehler: " + error.message };
        }
    }
});