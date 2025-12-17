const { app, output, input } = require('@azure/functions');

// 1. Definition: Wir wollen Daten in Cosmos DB SCHREIBEN
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString', // Der Name aus Schritt 2
    createIfNotExists: true
});

// 2. Definition: Wir wollen Daten aus Cosmos DB LESEN
const cosmosInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'tours',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c' // Hol alles
});

app.http('tours', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    extraInputs: [cosmosInput],   // Wir bereiten das Lesen vor
    extraOutputs: [cosmosOutput], // Wir bereiten das Schreiben vor
    
    handler: async (request, context) => {
        
        // A) DATEN LESEN (GET)
        if (request.method === 'GET') {
            // Die Daten kommen automatisch über das Input-Binding rein
            const toursFromDB = context.extraInputs.get(cosmosInput);
            return { jsonBody: toursFromDB };
        } 
        
        // B) DATEN SPEICHERN (POST)
        else if (request.method === 'POST') {
            const newTour = await request.json();

            // Wichtig: In Cosmos DB muss jedes Ding eine 'id' als String haben
            newTour.id = (Date.now()).toString(); 
            newTour.rating = 0;
            newTour.votes = 0;

            // Wir geben das neue Objekt an das Output-Binding
            context.extraOutputs.set(cosmosOutput, newTour);

            return { status: 201, jsonBody: newTour };
        }
    }
});