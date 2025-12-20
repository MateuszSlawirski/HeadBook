const { app, input, output } = require('@azure/functions');

// Wir brauchen Zugriff auf den Container "threads"
const cosmosInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c WHERE c.id = {id} AND c.topic = {topic}'
});

const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString'
});

app.http('addReply', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'reply',
    extraInputs: [cosmosInput],
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            const data = await request.json();
            
            // Wir brauchen ID und Topic, um den Beitrag zu finden
            if (!data.id || !data.topic || !data.text || !data.user) {
                return { status: 400, body: "Fehlende Daten!" };
            }

            // 1. Den alten Beitrag aus der DB holen
            const items = context.extraInputs.get(cosmosInput);
            if (!items || items.length === 0) {
                return { status: 404, body: "Beitrag nicht gefunden." };
            }
            const thread = items[0];

            // Änderungsvorschlag für addReply.js (Ausschnitt)
const newReply = {
    user: data.user,
    text: data.text,
    date: new Date().toISOString().split('T')[0], // Für die Anzeige (YYYY-MM-DD)
    createdAt: new Date().toISOString()           // Für exakte Sortierung
};

            // 3. Antwort hinzufügen (Array erstellen, falls noch nicht da)
            if (!thread.repliesList) {
                thread.repliesList = [];
            }
            thread.repliesList.push(newReply);

            
            
            // Counter hochzählen
            thread.replies = thread.repliesList.length;

            // 4. Update speichern (überschreibt das alte Dokument)
            context.extraOutputs.set(cosmosOutput, thread);

            return { status: 200, jsonBody: thread };

        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});