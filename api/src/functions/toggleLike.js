const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let container = null;

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("posts");
}

app.http('toggleLike', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {

        if (!container) return { status: 500, body: "DB error" };

        try {
            const body = await request.json();
            const { postId, userId } = body; // userId hier ist der LIKER, nicht der AUTOR

            if (!postId || !userId) return { status: 400, body: "Fehlende Daten" };

            // FIX: Wir suchen den Post per SQL-Query statt per direktem .read()
            // Das funktioniert auch ohne den Partition Key zu kennen.
            const querySpec = {
                query: "SELECT * FROM c WHERE c.id = @id",
                parameters: [{ name: "@id", value: postId }]
            };
            
            const { resources: posts } = await container.items.query(querySpec).fetchAll();

            if (posts.length === 0) {
                return { status: 404, body: "Post nicht gefunden (Query leer)" };
            }

            const post = posts[0]; // Das ist unser Post

            // Likes Logik (bleibt gleich)
            if (!post.likes) post.likes = [];
            const index = post.likes.indexOf(userId);
            let action = "added";

            if (index > -1) {
                post.likes.splice(index, 1);
                action = "removed";
            } else {
                post.likes.push(userId);
            }

            // FIX beim Speichern:
            // Jetzt kennen wir den Autor (post.userId) und nutzen ihn als Partition Key
            // WICHTIG: Wir gehen davon aus, dass dein Partition Key in der DB wirklich 'userId' heißt
            await container.item(post.id, post.userId).replace(post);

            return { 
                status: 200, 
                jsonBody: { 
                    action: action, 
                    likesCount: post.likes.length 
                } 
            };

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});