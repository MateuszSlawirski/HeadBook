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
                // ÄNDERUNG: jsonBody statt body
                return { status: 400, jsonBody: { error: "Keine UID gesendet" } };
            }

            // 2. Das User-Objekt vorbereiten
            const userProfile = {
                id: uid,
                email: email,
                displayName: displayName || "Biker",
                lastLogin: new Date().toISOString()
            };

            // 3. Speichern (Upsert)
            context.extraOutputs.set(cosmosOutput, userProfile);

            // ÄNDERUNG: Wir senden jetzt ein echtes JSON-Objekt zurück
            return { status: 200, jsonBody: { message: "User erfolgreich synchronisiert." } };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            // ÄNDERUNG: Auch im Fehlerfall JSON senden
            return { status: 500, jsonBody: { error: "Interner Server Fehler: " + error.message } };
        }
    }
});