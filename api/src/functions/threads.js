const { app, input } = require('@azure/functions');
const crypto = require('crypto');
// 1. Verbindung zur Datenbank (Container: threads)
const threadsInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c' 
});

// 2. Die Funktion
app.http('getThreads', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'threads', // Die URL ist dann: /api/threads?topic=BMW...
    extraInputs: [threadsInput],
    handler: async (request, context) => {
        // Alle Beiträge aus der DB holen
        const allThreads = context.extraInputs.get(threadsInput);
        
        // Lesen, wonach der User gefragt hat (z.B. ?topic=Honda)
        const searchedTopic = request.query.get('topic');

        if (!allThreads) {
            return { jsonBody: [] };
        }

        // Wenn ein Thema gesucht wird, filtern wir die Liste
        if (searchedTopic) {
            // Wir filtern: Behalte nur die Items, wo topic übereinstimmt
            const filtered = allThreads.filter(t => t.topic === searchedTopic);
            return { jsonBody: filtered };
        }

        // Wenn kein Thema angegeben ist, geben wir alles zurück (optional)
        return { jsonBody: allThreads };
    }
});