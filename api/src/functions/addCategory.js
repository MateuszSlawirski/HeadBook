const { app, input, output } = require('@azure/functions');

// Wir holen das Forum-Struktur-Dokument aus dem Container "forum"
const cosmosInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'forum',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c WHERE c.id = {mainCatId}'
});

const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'forum',
    connection: 'CosmosDbConnectionString'
});

app.http('addCategory', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'forum/category',
    extraInputs: [cosmosInput],
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            const data = await request.json();
            const { mainCatId, title, desc } = data;

            if (!mainCatId || !title) {
                return { status: 400, body: "Hauptkategorie und Titel werden benötigt." };
            }

            // 1. Das Dokument der Hauptkategorie (z.B. "bikes") finden
            const items = context.extraInputs.get(cosmosInput);
            if (!items || items.length === 0) {
                return { status: 404, body: "Hauptkategorie in der Datenbank nicht gefunden." };
            }
            const forumDoc = items[0];

            // 2. Prüfen, ob das Thema schon existiert
            if (!forumDoc.topics) forumDoc.topics = [];
            const exists = forumDoc.topics.find(t => t.title.toLowerCase() === title.toLowerCase());
            if (exists) {
                return { status: 409, body: "Dieses Thema existiert bereits." };
            }

            // 3. Neues Thema hinzufügen
            const newTopic = {
                title: title,
                desc: desc || "Keine Beschreibung vorhanden.",
                createdAt: new Date().toISOString()
            };
            forumDoc.topics.push(newTopic);

            // 4. In Cosmos DB speichern
            context.extraOutputs.set(cosmosOutput, forumDoc);

            return { status: 201, jsonBody: newTopic };

        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});