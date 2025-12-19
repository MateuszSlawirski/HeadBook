const { app, input } = require('@azure/functions');

// Input Binding: Alle Daten aus Container "tours" holen
const toursInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c ORDER BY c.createdAt DESC'
});

app.http('GetTours', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tours', // GET /api/tours
    extraInputs: [toursInput],
    handler: async (request, context) => {
        const tours = context.extraInputs.get(toursInput);
        
        // Falls leer, geben wir ein leeres Array zurück
        return { jsonBody: tours || [] };
    }
});