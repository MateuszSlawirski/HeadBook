const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

const cosmosConnectionString = process.env.CosmosDbConnectionString;
let client = null;
let database = null;

if (cosmosConnectionString) {
    client = new CosmosClient(cosmosConnectionString);
    database = client.database("riderpoint-db");
}

app.http('deleteItem', {
    methods: ['POST', 'DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (!client) return { status: 500, body: "DB Error" };

        try {
            const body = await request.json();
            const { type, id, partitionKey, parentId } = body; 
            
            let containerName = "";
            let operation = "deleteDoc"; 

            // 1. Container und Strategie wählen
            switch (type) {
                case 'post':
                    containerName = "posts";
                    break;
                case 'tour':
                    containerName = "tours";
                    break;
                case 'thread':
                    containerName = "threads";
                    break;
                // --- NEU: Topic (Unterkategorie) löschen ---
                case 'topic':
                    containerName = "forum";      // Liegt im 'forum' Container
                    operation = "deleteSubItem";  // Ist ein Teil eines Dokuments
                    break;
                // ------------------------------------------
                case 'comment': 
                    containerName = "posts";
                    operation = "deleteSubItem";
                    break;
                case 'reply': 
                    containerName = "threads";
                    operation = "deleteSubItem";
                    break;
                default:
                    return { status: 400, body: "Unbekannter Typ: " + type };
            }

            const container = database.container(containerName);

            // 2. Löschen ausführen
            if (operation === "deleteDoc") {
                // Ganzes Dokument löschen
                await container.item(id, partitionKey).delete();
                return { status: 200, jsonBody: { message: "Gelöscht" } };

            } else {
                // Unter-Element löschen (Kommentar, Reply oder Topic)
                // Wir laden das Eltern-Dokument
                const { resource: doc } = await container.item(parentId, partitionKey).read();
                
                if (!doc) return { status: 404, body: "Eltern-Dokument nicht gefunden" };

                if (type === 'comment') {
                    // Kommentar löschen
                    const idx = doc.comments.findIndex(c => c.text === body.commentText && c.user === body.commentUser);
                    if (idx > -1) doc.comments.splice(idx, 1);
                } 
                else if (type === 'reply') {
                    // Antwort löschen
                    if (doc.repliesList) {
                        const idx = doc.repliesList.findIndex(r => r.text === body.commentText && r.user === body.commentUser);
                        if (idx > -1) {
                            doc.repliesList.splice(idx, 1);
                            doc.replies = doc.repliesList.length;
                        }
                    }
                }
                // --- NEU: Topic aus der Liste entfernen ---
                else if (type === 'topic') {
                    if (doc.topics) {
                        // Wir suchen nach ID oder Titel
                        const idx = doc.topics.findIndex(t => t.id === id || t.title === id);
                        if (idx > -1) {
                            doc.topics.splice(idx, 1);
                        }
                    }
                }
                // ------------------------------------------

                // Speichern
                await container.item(doc.id, partitionKey).replace(doc);
                return { status: 200, jsonBody: { message: "Update erfolgreich" } };
            }

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});