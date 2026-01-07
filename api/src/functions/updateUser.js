const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');
const multipart = require('parse-multipart-data'); // Dieses Paket muss in die package.json

// Verbindungsdaten aus den Umgebungsvariablen
const blobConnectionString = process.env.AzureWebJobsStorage; // oder dein headbookstorage Key
const cosmosConnectionString = process.env.CosmosDbConnectionString;

app.http('updateUser', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const contentType = request.headers.get('content-type');
            const boundary = contentType.split('boundary=')[1];
            const bodyBuffer = Buffer.from(await request.arrayBuffer());
            const parts = multipart.parse(bodyBuffer, boundary);

            // Daten aus den Parts extrahieren
            const uid = parts.find(p => p.name === 'uid')?.data.toString();
            const bio = parts.find(p => p.name === 'bio')?.data.toString();
            const profilePicPart = parts.find(p => p.name === 'profilePic');

            if (!uid) return { status: 400, body: "UID fehlt" };

            let photoUrl = null;

            // 1. Bildupload in den Blob Storage
            if (profilePicPart) {
                const blobServiceClient = BlobServiceClient.fromConnectionString(blobConnectionString);
                const containerClient = blobServiceClient.getContainerClient('profile-pics');
                await containerClient.createIfNotExists({ access: 'blob' });

                const blobName = `${uid}-${Date.now()}.jpg`;
                const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                
                await blockBlobClient.upload(profilePicPart.data, profilePicPart.data.length);
                photoUrl = blockBlobClient.url;
            }

            // 2. Datenbank-Update in Cosmos DB
            const client = new CosmosClient(cosmosConnectionString);
            const container = client.database("riderpoint-db").container("users");
            const { resource: userDoc } = await container.item(uid, uid).read();

            if (userDoc) {
                if (bio !== undefined) userDoc.bio = bio;
                if (photoUrl) userDoc.photoUrl = photoUrl;
                await container.item(uid, uid).replace(userDoc);
                return { status: 200, jsonBody: userDoc };
            }

            return { status: 404, body: "User nicht gefunden" };
        } catch (error) {
            return { status: 500, body: error.message };
        }
    }
});