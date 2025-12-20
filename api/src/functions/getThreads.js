const { app, input } = require('@azure/functions');

// Input Binding: Wir bereiten die DB-Verbindung vor
// HINWEIS: Wir verwenden hier keine harte SQL-Query im Binding, 
// da wir dynamisch filtern wollen (siehe Handler).
const cosmosInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c' // Default: Holt alles (wird unten ggf. gefiltert)
});

app.http('getThreads', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'threads', // Lauscht auf GET /api/threads
    extraInputs: [cosmosInput],
    handler: async (request, context) => {
        // 1. Alle Threads aus der DB holen (via Input Binding)
        let threads = context.extraInputs.get(cosmosInput);

        // 2. Prüfen, ob nach einem bestimmten Thema (Topic) gefiltert werden soll
        const topicFilter = request.query.get('topic');

        if (threads && topicFilter) {
            // Filtern: Nur Threads zurückgeben, die zu diesem Thema gehören
            threads = threads.filter(t => t.topic === topicFilter);
        }

        // 3. Sortierung: Neueste zuerst (falls nicht schon durch SQL passiert)
        if (threads) {
            threads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        return { 
            status: 200, 
            jsonBody: threads || [] 
        };
    }
});