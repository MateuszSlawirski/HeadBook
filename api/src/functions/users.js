const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let container = null;

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("users");
}

app.http('users', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        
        if (!container) return { status: 500, jsonBody: { error: "DB nicht verbunden" } };

        try {
            const data = await request.json();
            const { uid, email, displayName } = data;

            if (!uid) {
                return { status: 400, jsonBody: { error: "Keine UID gesendet" } };
            }

            // 1. Erstmal schauen: Gibt es den User schon in der DB?
            let existingUser = null;
            try {
                const { resource } = await container.item(uid, uid).read();
                existingUser = resource;
            } catch (err) {
                // User existiert noch nicht, kein Problem.
            }

            // 2. Das User-Objekt vorbereiten - DATEN SCHÜTZEN
            const userToSave = {
                id: uid,
                email: email,
                displayName: displayName || (existingUser ? existingUser.displayName : "Biker"),
                lastLogin: new Date().toISOString(),
                role: (existingUser && existingUser.role) ? existingUser.role : "user",
                
                // HIER SIND DIE WICHTIGEN ZEILEN:
                // Wenn Daten da sind, behalten. Wenn nicht, Standardwert setzen.
                bio: existingUser ? (existingUser.bio || "") : "",
                photoUrl: existingUser ? (existingUser.photoUrl || null) : null,
                friends: existingUser ? (existingUser.friends || []) : []
            };

            // 3. Speichern (Upsert)
            await container.items.upsert(userToSave);

            // 4. Den fertigen User zurück ans Frontend schicken
            return { status: 200, jsonBody: userToSave };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            return { status: 500, jsonBody: { error: "Interner Server Fehler: " + error.message } };
        }
    }
});