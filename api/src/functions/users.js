const { app, output } = require('@azure/functions');

// Wir definieren den Ausgang (Output), um zu speichern
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'users',
    connection: 'CosmosDbConnectionString',
    createIfNotExists: true
});

// WICHTIG: Wir nennen die Funktion jetzt "users" (statt user-sync)
// Dadurch ist die URL automatisch: /api/users
// Das passt perfekt zu deinem Frontend.
app.http('users', {
    methods: ['POST'],
    authLevel: 'anonymous',
    // route: 'users', <--- Brauchen wir nicht mehr, da der Name jetzt stimmt!
    extraOutputs: [cosmosOutput], 
    
    handler: async (request, context) => {
        try {
            // 1. Daten aus dem Frontend lesen
            const data = await request.json();
            const { uid, email, displayName } = data;

            if (!uid) {
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

            return { status: 200, jsonBody: { message: "User erfolgreich synchronisiert." } };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            return { status: 500, jsonBody: { error: "Interner Server Fehler: " + error.message } };
        }
    }
});