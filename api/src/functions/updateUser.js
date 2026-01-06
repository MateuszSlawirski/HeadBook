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
            // uid: Wer bist du?
            // friendId: Wen willst du hinzufügen? (Optional)
            
            if (!uid) return { status: 400, body: "User ID fehlt" };

            const container = database.container("users");
            
            // 1. User aus DB holen
            // Wir nutzen 'uid' als ID und PartitionKey (in users ist id=uid)
            const { resource: userDoc } = await container.item(uid, uid).read();

            if (!userDoc) {
                // Sollte eigentlich nicht passieren, da syncUserWithBackend den User anlegt
                return { status: 404, body: "User nicht gefunden" };
            }

            // 2. Daten aktualisieren
            let updated = false;

            if (bio !== undefined) { userDoc.bio = bio; updated = true; }
            if (photoUrl !== undefined) { userDoc.photoUrl = photoUrl; updated = true; }
            
            if (friendId) {
                if (!userDoc.friends) userDoc.friends = [];
                if (!userDoc.friends.includes(friendId)) {
                    userDoc.friends.push(friendId);
                    updated = true;
                }
            }

            // 3. Speichern (wenn was geändert wurde)
            if (updated) {
                await container.item(uid, uid).replace(userDoc);
                return { status: 200, jsonBody: userDoc };
            } else {
                return { status: 200, jsonBody: { message: "Nichts zu ändern" } };
            }

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});