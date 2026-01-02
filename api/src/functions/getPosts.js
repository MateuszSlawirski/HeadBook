const { app, input } = require('@azure/functions');

const postsInput = input.cosmosDB({
    databaseName: 'riderpoint-db',
    containerName: 'posts',
    connection: 'CosmosDbConnectionString',
    sqlQuery: 'SELECT * FROM c ORDER BY c.createdAt DESC'
});

app.http('getPosts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'GetPosts', 
    extraInputs: [postsInput],
    handler: async (request, context) => {
        const posts = context.extraInputs.get(postsInput);
        return { 
            status: 200, 
            jsonBody: posts || [] 
        };
    }
});