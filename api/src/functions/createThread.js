const { app, output } = require('@azure/functions');
const crypto = require('crypto');

const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'threads',
    connection: 'CosmosDbConnectionString'
});

app.http('createThread', {
    methods: ['POST'],
    authLevel: 'anonymous',
    // route: 'createThread', <--- ENTFERNT (Standard ist eh Dateiname)
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            const data = await request.json();

            if (!data.topic || !data.title || !data.user) {
                return { status: 400, body: "Fehlende Daten (Topic, Title oder User)" };
            }

            const newThread = {
                id: crypto.randomUUID(),
                topic: data.topic,
                title: data.title,
                text: data.text || "",
                user: data.user,
                replies: 0,
                date: new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString()
            };

            context.extraOutputs.set(cosmosOutput, newThread);

            return { status: 201, jsonBody: newThread };

        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});