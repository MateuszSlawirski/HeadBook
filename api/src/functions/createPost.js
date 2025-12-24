const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');
const multipart = require('parse-multipart-data');

// Verbindungsdaten aus den Umgebungsvariablen holen
const connectionString = process.env.AzureWebJobsStorage; 
const cosmosConnectionString = process.env.COSMOS_CONNECTION_STRING;

// Setup für Blob Storage (Bilder)
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerName = "uploads";
const containerClient = blobServiceClient.getContainerClient(containerName);

// Setup für Cosmos DB (Datenbank)
const client = new CosmosClient(cosmosConnectionString);
const database = client.database("riderpoint-db"); // Dein DB Name aus dem Screenshot
const container = database.container("posts");     // Dein neuer Container Name

app.http('createPost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Verarbeite neuen Post...');

        try {
            // 1. Daten aus dem Request lesen
            // Wir müssen den "Body" als Buffer lesen, um Bilder verarbeiten zu können
            const bodyBuffer = Buffer.from(await request.arrayBuffer());
            const boundary = multipart.getBoundary(request.headers.get('content-type'));
            
            // Falls kein Boundary gefunden wurde, ist es vielleicht nur Text JSON?
            // Hier gehen wir aber davon aus, dass das Frontend immer FormData sendet.
            const parts = multipart.parse(bodyBuffer, boundary);

            let contentText = "";
            let mediaUrl = "";
            let mediaType = "";
            const userId = request.headers.get('x-user-id') || "anonymous"; // User ID vom Frontend

            // 2. Durch die gesendeten Teile (Text & Bild) gehen
            for (const part of parts) {
                if (part.name === 'content') {
                    contentText = part.data.toString();
                } 
                else if (part.filename) {
                    // Es ist eine Datei!
                    const fileExtension = part.filename.split('.').pop();
                    const uniqueName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExtension}`;
                    
                    const blockBlobClient = containerClient.getBlockBlobClient(uniqueName);
                    
                    // Hochladen
                    await blockBlobClient.upload(part.data, part.data.length, {
                        blobHTTPHeaders: { blobContentType: part.type }
                    });

                    // Die URL speichern wir uns
                    mediaUrl = blockBlobClient.url;
                    
                    // Prüfen ob Video oder Bild
                    if (part.type.includes('video')) {
                        mediaType = 'video';
                    } else {
                        mediaType = 'image';
                    }
                }
            }

            // 3. Eintrag in der Datenbank erstellen
            const newPost = {
                id: Math.random().toString(36).substr(2, 9),
                userId: userId,
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