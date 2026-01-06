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
                // User existiert noch nicht (404), kein Problem.
            }

            // 2. Das User-Objekt vorbereiten - Vorhandene Daten schützen!
const userToSave = {
    id: uid,
    email: email,
    displayName: displayName || (existingUser ? existingUser.displayName : "Biker"),
    lastLogin: new Date().toISOString(),
    role: (existingUser && existingUser.role) ? existingUser.role : "user",
    
    // ZUSÄTZLICH: Diese Zeilen verhindern das Löschen beim Neuladen
    bio: existingUser ? existingUser.bio : "",
    photoUrl: existingUser ? existingUser.photoUrl : null,
    friends: existingUser ? (existingUser.friends || []) : []
};

            // 3. Speichern (Upsert)
            await container.items.upsert(userToSave);

            // 4. UND WICHTIG: Den fertigen User (mit Rolle!) zurück ans Frontend schicken
            return { status: 200, jsonBody: userToSave };

        } catch (error) {
            context.log("Fehler beim Speichern:", error);
            return { status: 500, jsonBody: { error: "Interner Server Fehler: " + error.message } };
        }
    }
});