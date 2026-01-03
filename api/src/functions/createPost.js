const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');
// ACHTUNG: Stelle sicher, dass du "npm install parse-multipart-data" ausgeführt hast!
const multipart = require('parse-multipart-data');

// 1. KORREKTUR: Hier stand der falsche Variablen-Name!
const cosmosConnectionString = process.env.CosmosDbConnectionString;
const connectionString = process.env.BLOB_STORAGE_CONNECTION;

// Wir verbinden uns nur, wenn die Keys auch da sind (verhindert Absturz)
let containerClient = null;
let container = null;

if (connectionString) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    containerClient = blobServiceClient.getContainerClient("uploads");
}

if (cosmosConnectionString) {
    const client = new CosmosClient(cosmosConnectionString);
    const database = client.database("riderpoint-db");
    container = database.container("posts");
}

app.http('createPost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // Sicherheits-Check beim Ausführen
        if (!container || !containerClient) {
            return { status: 500, body: "Server-Fehler: Datenbank oder Speicher nicht konfiguriert." };
        }

        context.log('Verarbeite neuen Post...');

        try {
            const bodyBuffer = Buffer.from(await request.arrayBuffer());
            const boundary = multipart.getBoundary(request.headers.get('content-type'));
            const parts = multipart.parse(bodyBuffer, boundary);

            let username = "Gast";
            let contentText = "";
            let mediaUrl = "";
            let mediaType = "";
            const userId = request.headers.get('x-user-id') || "anonymous";

            for (const part of parts) {
                if (part.name === 'content') {
                    contentText = part.data.toString();
                } 
                else if (part.name === 'username') {
                username = part.data.toString();
            }
                else if (part.filename) {
                    const fileExtension = part.filename.split('.').pop();
                    const uniqueName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExtension}`;
                    const blockBlobClient = containerClient.getBlockBlobClient(uniqueName);
                    
                    await blockBlobClient.upload(part.data, part.data.length, {
                        blobHTTPHeaders: { blobContentType: part.type }
                    });

                    mediaUrl = blockBlobClient.url;
                    mediaType = part.type.includes('video') ? 'video' : 'image';
                }
            }

            const newPost = {
                id: Math.random().toString(36).substr(2, 9),
                userId: userId,
                user: username,
                content: contentText,
                mediaUrl: mediaUrl,
                mediaType: mediaType,
                createdAt: new Date().toISOString(),
                likes: [],
                comments: []
            };

            const { resource: createdItem } = await container.items.create(newPost);
            return { body: JSON.stringify(createdItem), status: 201 };

        } catch (error) {
            context.log(error);
            return { body: "Fehler beim Upload: " + error.message, status: 500 };
        }
    }
});