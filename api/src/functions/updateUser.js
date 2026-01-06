const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let client = null;
let database = null;

if (cosmosConnectionString) {
    client = new CosmosClient(cosmosConnectionString);
    database = client.database("riderpoint-db");
}

app.http('updateUser', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (!client) return { status: 500, body: "DB Error" };

        try {
            const body = await request.json();
            const { uid, bio, photoUrl, friendId } = body; 
            
            if (!uid) return { status: 400, body: "User ID fehlt" };

            const container = database.container("users");
            
            // 1. User Dokument holen
            const { resource: userDoc } = await container.item(uid, uid).read();

            if (!userDoc) {
                return { status: 404, body: "User nicht gefunden" };
            }

            // 2. Daten ändern
            let updated = false;

            if (bio !== undefined) { 
                userDoc.bio = bio; 
                updated = true; 
            }
            if (photoUrl !== undefined) { 
                userDoc.photoUrl = photoUrl; 
                updated = true; 
            }
            
            // Freund hinzufügen (Logik: Array erstellen falls nicht da, prüfen ob schon drin)
            if (friendId) {
                if (!userDoc.friends) userDoc.friends = [];
                if (!userDoc.friends.includes(friendId)) {
                    userDoc.friends.push(friendId);
                    updated = true;
                }
            }

            // 3. Speichern
            if (updated) {
                await container.item(uid, uid).replace(userDoc);
                return { status: 200, jsonBody: userDoc };
            } else {
                return { status: 200, jsonBody: { message: "Keine Änderungen" } };
            }

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});