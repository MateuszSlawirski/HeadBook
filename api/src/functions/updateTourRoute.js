const { app, input, output } = require('@azure/functions');

// Wir holen die Tour anhand der ID
const tourInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c WHERE c.id = {id}'
});

const tourOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString'
});

app.http('updateTourRoute', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'tours/update-route',
    extraInputs: [tourInput],
    extraOutputs: [tourOutput],
    handler: async (request, context) => {
        try {
            const { id, routeGeometry, km } = await request.json();
            
            const items = context.extraInputs.get(tourInput);
            if (!items || items.length === 0) return { status: 404, body: "Tour nicht gefunden" };
            
            const tour = items[0];
            
            // Daten aktualisieren
            tour.routeGeometry = routeGeometry;
            if(km) tour.km = km; // km gleich mit aktualisieren
            
            // Speichern
            context.extraOutputs.set(tourOutput, tour);
            
            return { status: 200, jsonBody: tour };
        } catch (e) {
            return { status: 500, body: e.message };
        }
    }
});