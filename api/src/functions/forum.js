const { app, input } = require('@azure/functions');

// 1. Definition: Wo liegen die Daten? (Input Binding)
const forumInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'forum',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c'
});

// 2. Die Funktion: Hört auf GET /api/forum
app.http('getForum', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'forum',
    extraInputs: [forumInput], // Hier sagen wir dem Kellner: "Nimm den Schlüssel zur Datenbank mit"
    handler: async (request, context) => {
        // Die Daten holen, die das Input Binding gefunden hat
        const categories = context.extraInputs.get(forumInput);

        if (!categories || categories.length === 0) {
            return { status: 404, body: "Keine Foren-Kategorien gefunden." };
        }

        // Erfolgreich zurückgeben
        return { jsonBody: categories };
    }
});