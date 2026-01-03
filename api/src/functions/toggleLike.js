const { app } = require('@azure/functions');
const { CosmosClient } = require("@azure/cosmos");

const client = new CosmosClient({ 
    endpoint: process.env.COSMOS_ENDPOINT, 
    key: process.env.COSMOS_KEY 
});

app.http('toggleLike', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { postId, userId } = body;

            if (!postId || !userId) return { status: 400, body: "Daten fehlen" };

            const database = client.database("RiderpointDB");
            const container = database.container("Posts");

            const { resource: post } = await container.item(postId, postId).read();
            if (!post) return { status: 404, body: "Post nicht gefunden" };

            if (!post.likes) post.likes = [];

            const index = post.likes.indexOf(userId);
            let action = "added";

            if (index > -1) {
                post.likes.splice(index, 1); // Entfernen
                action = "removed";
            } else {
                post.likes.push(userId); // Hinzufügen
            }

            await container.item(postId, postId).replace(post);

            return { status: 200, jsonBody: { action, likesCount: post.likes.length } };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});