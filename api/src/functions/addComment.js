const { app } = require('@azure/functions');
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({ 
    endpoint: process.env.COSMOS_ENDPOINT, 
    key: process.env.COSMOS_KEY 
});

app.http('addComment', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { postId, text, user } = body;

            if (!postId || !text) {
                return { status: 400, body: "Fehlende Daten" };
            }

            const database = client.database("RiderpointDB");
            const container = database.container("Posts");

            // Post laden
            const { resource: post } = await container.item(postId, postId).read();
            if (!post) return { status: 404, body: "Post nicht gefunden" };

            // Kommentar hinzufügen
            if (!post.comments) post.comments = [];
            
            const newComment = {
                user: user || "Unbekannt",
                text: text,
                date: new Date().toISOString()
            };
            post.comments.push(newComment);

            // Speichern
            await container.item(postId, postId).replace(post);

            return { status: 200, jsonBody: newComment };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});