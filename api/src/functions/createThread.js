const { app, output } = require('@azure/functions');

// Wir definieren den Ausgang (wohin sollen die Daten?)
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString'
});

app.http('createThread', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'threads', // Gleiche URL wie beim Lesen, aber diesmal POST
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            // 1. Daten aus dem Request lesen
            const data = await request.json();

            // 2. Ein paar Sicherheits-Checks
            if (!data.topic || !data.title || !data.user) {
                return { status: 400, body: "Fehlende Daten (Topic, Title oder User)" };
            }

            // 3. Das fertige Objekt für die Datenbank bauen
            const newThread = {
                id: crypto.randomUUID(), // Zufällige ID generieren
                topic: data.topic,
                title: data.title,
                text: data.text || "",   // Der eigentliche Text
                user: data.user,
                replies: 0,
                date: new Date().toISOString().split('T')[0] // Heute (YYYY-MM-DD)
            };

            // 4. In die Datenbank speichern
            context.extraOutputs.set(cosmosOutput, newThread);

            // 5. Erfolgsmeldung zurückgeben
            return { status: 201, jsonBody: newThread };

        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});