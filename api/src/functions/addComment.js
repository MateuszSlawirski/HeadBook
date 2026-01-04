const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let container = null;

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("posts");
}

app.http('addComment', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        
        if (!container) {
            return { status: 500, body: "Server-Fehler: Datenbank nicht konfiguriert." };
        }

        try {
            const body = await request.json();
            const { postId, text, user } = body;

            if (!postId || !text) return { status: 400, body: "Daten fehlen" };

            // FIX: Post per Query suchen (Partition Key unabhängig)
            const querySpec = {
                query: "SELECT * FROM c WHERE c.id = @id",
                parameters: [{ name: "@id", value: postId }]
            };
            
            const { resources: posts } = await container.items.query(querySpec).fetchAll();
            
            if (posts.length === 0) {
                return { status: 404, body: "Post nicht gefunden" };
            }

            const post = posts[0]; // Post gefunden

            // Array vorbereiten
            if (!post.comments) post.comments = [];
            
            const newComment = {
                user: user || "Unbekannt",
                text: text,
                date: new Date().toISOString()
            };
            post.comments.push(newComment);

            // FIX: Speichern mit dem korrekten Partition Key (post.userId)
            // Wir nutzen post.id und post.userId, damit Cosmos DB weiß, wo es liegt.
            await container.item(post.id, post.userId).replace(post);

            return { status: 200, jsonBody: newComment };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: "Fehler: " + error.message };
        }
    }
});