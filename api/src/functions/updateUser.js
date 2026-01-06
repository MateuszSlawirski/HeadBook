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
            
            // User lesen oder neu anlegen (Self-Healing)
            let userDoc;
            try {
                const response = await container.item(uid, uid).read();
                userDoc = response.resource;
            } catch(e) {}

            if (!userDoc) {
                userDoc = { id: uid, uid: uid, role: "user", friends: [], bio: "" };
                await container.items.create(userDoc);
            }

            // Daten aktualisieren
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

            if (updated) {
                await container.item(uid, uid).replace(userDoc);
                return { status: 200, jsonBody: userDoc };
            } else {
                return { status: 200, jsonBody: { message: "Alles aktuell" } };
            }

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});