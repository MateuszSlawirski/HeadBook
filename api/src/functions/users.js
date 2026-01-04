const { app, output } = require('@azure/functions');

// Hier ist das Output-Binding okay, da wir beim User-Sync meistens nur "Upsert" (Erstellen/Überschreiben) machen 
// und die User-ID (uid) meistens auch der Partition Key ist.
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'users',
    connection: 'CosmosDbConnectionString',
    createIfNotExists: true
});

app.http('user-sync', {
    methods: ['POST'],
    authLevel: 'anonymous',
    // route: 'users', <--- ENTFERNT. Neue URL: /api/user-sync
    extraOutputs: [cosmosOutput],
    
    handler: async (request, context) => {
        try {
            const data = await request.json();
            const { uid, email, displayName } = data;

            if (!uid) {
                return { status: 400, jsonBody: { error: "Keine UID gesendet" } };
            }

            const userProfile = {
                id: uid,
                email: email,
                displayName: displayName || "Biker",
                lastLogin: new Date().toISOString()
            };

            context.extraOutputs.set(cosmosOutput, userProfile);

            return { status: 200, jsonBody: { message: "User erfolgreich synchronisiert." } };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            return { status: 500, jsonBody: { error: "Interner Server Fehler: " + error.message } };
        }
    }
});