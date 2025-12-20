const { app, input, output } = require('@azure/functions');

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

app.http('voteTour', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'vote',
    extraInputs: [tourInput],
    extraOutputs: [tourOutput],
    handler: async (request, context) => {
        const { id, rating } = await request.json(); // rating ist 1 bis 5

        if (!id || !rating || rating < 1 || rating > 5) {
            return { status: 400, body: "Ungültige Daten" };
        }

        const items = context.extraInputs.get(tourInput);
        if (!items || items.length === 0) {
            return { status: 404, body: "Tour nicht gefunden" };
        }
        
        const tour = items[0];

        // --- Mathe: Laufenden Durchschnitt berechnen ---
        const currentVotes = tour.votes || 0;
        const currentRating = tour.rating || 0;

        // Neue Gesamtpunktzahl berechnen
        const newTotalScore = (currentVotes * currentRating) + rating;
        const newVotesCount = currentVotes + 1;
        
        // Neuen Durchschnitt berechnen und runden
        tour.rating = parseFloat((newTotalScore / newVotesCount).toFixed(1));
        tour.votes = newVotesCount;

        // Speichern
        context.extraOutputs.set(tourOutput, tour);

        return { status: 200, jsonBody: tour };
    }
});