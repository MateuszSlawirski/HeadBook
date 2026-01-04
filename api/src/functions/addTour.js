const { app, output } = require('@azure/functions');
const crypto = require('crypto');

// Output Binding für Cosmos DB
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString'
});

app.http('addTour', {
    methods: ['POST'],
    authLevel: 'anonymous',
    // Zwingend entfernen, damit die Route wieder /api/addTour heißt:
    // route: 'tours', 
    extraOutputs: [cosmosOutput],
    handler: async (request, context) => {
        try {
            const data = await request.json();

            if (!data.title || !data.country) {
                return { status: 400, body: "Titel und Land sind Pflichtfelder." };
            }

            // Sicherstellen, dass alles für die DB da ist
            const newTour = {
                id: crypto.randomUUID(),
                ...data, 
                createdAt: new Date().toISOString()
            };

            // WICHTIG: Falls dein Container "tours" auch /userId als Partition Key hat,
            // muss sichergestellt sein, dass 'data' eine userId enthält!
            // Wenn der PK einfach /id ist, passt alles so.

            // Speichern via Output Binding (das ist sehr effizient)
            context.extraOutputs.set(cosmosOutput, newTour);

            return { status: 201, jsonBody: newTour };
        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});