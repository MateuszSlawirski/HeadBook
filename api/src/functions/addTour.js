const { app, output } = require('@azure/functions');
const crypto = require('crypto');

// Output Binding für Cosmos DB (Container "tours")
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString'
});

app.http('addTour', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'tours', // POST /api/tours
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            const data = await request.json();

            if (!data.title || !data.country) {
                return { status: 400, body: "Titel und Land sind Pflichtfelder." };
            }

            const newTour = {
                id: crypto.randomUUID(),
                ...data, // Übernimmt coords, title, desc usw. vom Frontend
                createdAt: new Date().toISOString()
            };

            // Speichern
            context.extraOutputs.set(cosmosOutput, newTour);

            return { status: 201, jsonBody: newTour };
        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});