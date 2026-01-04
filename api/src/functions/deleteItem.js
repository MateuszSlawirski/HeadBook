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
            // type: 'post', 'tour', 'thread', 'comment', 'reply'
            // id: ID des Elements (oder ID des Kommentars)
            // partitionKey: Wichtig für Cosmos DB (z.B. userId oder country)
            // parentId: Nur nötig, wenn wir Kommentare/Replies löschen (ID des Posts/Threads)

            // Sicherheits-Check: Hier könntest du prüfen, ob der User Admin ist.
            // (Wir vertrauen vorerst dem Frontend, da du der einzige Admin bist)
            
            let containerName = "";
            let operation = "deleteDoc"; // oder "updateDoc" (für Kommentare)

            // 1. Strategie wählen
            switch (type) {
                case 'post':
                    containerName = "posts";
                    break;
                case 'tour':
                    containerName = "tours";
                    break;
                case 'thread':
                    containerName = "threads"; // Achtung: PartitionKey ist hier oft 'topic'
                    break;
                case 'comment': // Kommentar in einem Post
                    containerName = "posts";
                    operation = "deleteSubItem";
                    break;
                case 'reply': // Antwort in einem Thread
                    containerName = "threads";
                    operation = "deleteSubItem";
                    break;
                default:
                    return { status: 400, body: "Unbekannter Typ" };
            }

            const container = database.container(containerName);

            // 2. Ausführen
            if (operation === "deleteDoc") {
                // Ganzes Dokument löschen
                // WICHTIG: partitionKey muss stimmen, sonst knallt es.
                await container.item(id, partitionKey).delete();
                return { status: 200, jsonBody: { message: "Gelöscht" } };

            } else {
                // Unter-Element löschen (Kommentar/Reply)
                // Wir laden das Eltern-Dokument (Post oder Thread)
                // parentId ist hier die ID des Posts/Threads
                // partitionKey gehört zum Eltern-Dokument
                const { resource: doc } = await container.item(parentId, partitionKey).read();
                
                if (!doc) return { status: 404, body: "Eltern-Element nicht gefunden" };

                if (type === 'comment') {
                    // Kommentar aus Array filtern (wir nehmen an, Kommentare haben keine ID, also filtern wir nach Text+User oder Index? 
                    // BESSER: Wir erweitern addComment später um IDs. 
                    // FÜR JETZT: Wir löschen per Index oder Text-Match. 
                    // Trick: Frontend übergibt den KOMPLETTEN Kommentar-Text zum Finden.
                    
                    // Wir suchen den Index des Kommentars im Array
                    // body.commentText muss vom Frontend kommen
                    const idx = doc.comments.findIndex(c => c.text === body.commentText && c.user === body.commentUser);
                    if (idx > -1) doc.comments.splice(idx, 1);
                } 
                else if (type === 'reply') {
                    // Gleiches Spiel für Forum-Antworten
                    if (doc.repliesList) {
                        const idx = doc.repliesList.findIndex(r => r.text === body.commentText && r.user === body.commentUser);
                        if (idx > -1) {
                            doc.repliesList.splice(idx, 1);
                            doc.replies = doc.repliesList.length; // Counter fixen
                        }
                    }
                }

                // Speichern
                await container.item(doc.id, partitionKey).replace(doc);
                return { status: 200, jsonBody: { message: "Unter-Element gelöscht" } };
            }

        } catch (error) {
            context.log.error(error);
            return { status: 500, body: error.message };
        }
    }
});