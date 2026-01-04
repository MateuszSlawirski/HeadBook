const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let container = null;

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("threads");
}

app.http('addReply', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {

        if (!container) return { status: 500, body: "DB Error" };

        try {
            const data = await request.json();
            
            // Validierung
            if (!data.id || !data.text || !data.user) {
                return { status: 400, body: "Fehlende Daten (id, text, user)!" };
            }

            // 1. Thread suchen via ID
            const querySpec = {
                query: "SELECT * FROM c WHERE c.id = @id",
                parameters: [{ name: "@id", value: data.id }]
            };

            const { resources: items } = await container.items.query(querySpec).fetchAll();

            if (items.length === 0) {
                return { status: 404, body: "Beitrag nicht gefunden." };
            }
            
            const thread = items[0];

            // 2. Antwort bauen
            const newReply = {
                user: data.user,
                text: data.text,
                date: new Date().toISOString().split('T')[0], 
                createdAt: new Date().toISOString()
            };

            // 3. Array prüfen und pushen
            if (!thread.repliesList) {
                thread.repliesList = [];
            }
            thread.repliesList.push(newReply);
            
            // Counter aktualisieren
            thread.replies = thread.repliesList.length;

            // 4. FIX: Speichern mit korrektem Partition Key
            // Da dein PK "/topic" ist, müssen wir thread.topic übergeben!
            await container.item(thread.id, thread.topic).replace(thread);

            return { status: 200, jsonBody: thread };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});