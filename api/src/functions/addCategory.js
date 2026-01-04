const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let container = null;

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("forum");
}

app.http('addCategory', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        
        if (!container) return { status: 500, body: "DB Error: Container nicht initialisiert" };

        try {
            const data = await request.json();
            const { mainCatId, title, desc } = data;

            if (!mainCatId || !title) {
                return { status: 400, body: "Hauptkategorie und Titel werden benötigt." };
            }

            // 1. Dokument suchen
            const querySpec = {
                query: "SELECT * FROM c WHERE c.id = @id",
                parameters: [{ name: "@id", value: mainCatId }]
            };

            const { resources: items } = await container.items.query(querySpec).fetchAll();

            if (items.length === 0) {
                return { status: 404, body: "Hauptkategorie nicht gefunden." };
            }
            
            const forumDoc = items[0];

            // 2. Array prüfen
            if (!forumDoc.topics) forumDoc.topics = [];
            
            const exists = forumDoc.topics.find(t => t.title.toLowerCase() === title.toLowerCase());
            if (exists) {
                return { status: 409, body: "Dieses Thema existiert bereits." };
            }

            // 3. Neues Thema hinzufügen
            const newTopic = {
                title: title,
                desc: desc || "Keine Beschreibung.",
                createdAt: new Date().toISOString()
            };
            forumDoc.topics.push(newTopic);

            // 4. FIX: Speichern mit (id, partitionKey)
            // Da dein PK "/id" ist, ist der Partition Key identisch mit der ID.
            await container.item(forumDoc.id, forumDoc.id).replace(forumDoc);

            return { status: 201, jsonBody: newTopic };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});