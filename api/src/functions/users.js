const { app, output, input } = require('@azure/functions');

// Wir lesen aus der 'users' Tabelle
const cosmosInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'users',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c WHERE c.id = {id}' // Sucht genau diesen User
});

// Wir schreiben in die 'users' Tabelle (für neue User)
const cosmosOutput = output.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'users',
    connection: 'CosmosDbConnectionString',
    createIfNotExists: true
});

app.http('user-sync', {
    methods: ['POST'],
    authLevel: 'anonymous',
    extraInputs: [cosmosInput],
    extraOutputs: [cosmosOutput],
    
    handler: async (request, context) => {
        // Der Frontend schickt uns die User-Daten von Firebase
        const { uid, email } = await request.json();

        if (!uid) return { status: 400, body: "Keine UID gesendet" };

        // 1. In Datenbank suchen
        const existingUsers = context.extraInputs.get(cosmosInput);

        if (existingUsers && existingUsers.length > 0) {
            // User existiert schon -> Rolle zurückgeben
            const userInDb = existingUsers[0];
            return { jsonBody: userInDb };
        } else {
            // 2. User existiert noch nicht -> Neu anlegen als "user"
            const newUser = {
                id: uid,       // Die Firebase UID ist unser Schlüssel
                email: email,
                role: "user",  // Standard-Rolle
                createdAt: new Date().toISOString()
            };

            // Speichern
            context.extraOutputs.set(cosmosOutput, newUser);

            return { jsonBody: newUser };
        }
    }
});