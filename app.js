/* ==========================================
   APP V3.4 - STABLE & SORTED
   ========================================== */
console.log("%c APP V3.4 LOADED - REORDERED ", "background: black; color: lime; padding: 5px; font-weight: bold;");

import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const API_URL = "https://riderpoint-backend.azurewebsites.net/api";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// --- STATE VARIABLES ---
let allPostsCache = []; 
let toursData = []; 
let currentUser = null;
let currentRole = "guest"; 
let viewingUserProfile = null; 

// --- MAP STATE ---
let map = null;
let currentRouteLayer = null; 
let tempGpxData = null;

// --- FORUM STATE ---
let currentForumTopic = null; 
let currentCategoryId = null; 
let allForumData = []; 
let allThreadsCache = []; 

const USER_EDITABLE_CATEGORIES = ["bikes", "garage", "tours"];

/* ==========================================
   1. HELPER FUNCTIONS
   ========================================== */

window.showToast = (message, isError = false) => {
    const toastEl = document.getElementById('appToast');
    const msgEl = document.getElementById('toast-message');
    if (!toastEl || !msgEl) { console.log(message); return; }
    
    msgEl.innerText = message;
    toastEl.classList.remove('bg-success', 'bg-danger');
    toastEl.classList.add(isError ? 'bg-danger' : 'bg-success');
    
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
};

// Intelligente Namenssuche für "Fake Freunde" Problem
function findUserInfo(uid) {
    if (!uid) return { name: "Unbekannt", pic: null };
    
    // 1. Suche in Touren
    const tour = toursData.find(t => t.userId === uid);
    if (tour && tour.user) return { name: tour.user, pic: null };

    // 2. Suche in Posts
    const post = allPostsCache.find(p => p.userId === uid);
    if (post && post.user) return { name: post.user, pic: null };

    // 3. Suche in Forum Threads
    const thread = allThreadsCache.find(t => t.userId === uid || t.user === uid); // Fallback Logik
    if (thread && thread.user) return { name: thread.user, pic: null };

    // 4. Suche in Kommentaren (Tiefensuche)
    for (const p of allPostsCache) {
        if (p.comments) {
            const comment = p.comments.find(c => c.userId === uid); // Falls userId gespeichert
            if (comment && comment.user) return { name: comment.user, pic: null };
        }
    }

    // 5. Fallback: ID kürzen
    return { name: "User " + uid.substring(0, 5), pic: null };
}

/* ==========================================
   2. DATA LOADING
   ========================================== */

async function loadToursFromServer() {
    try {
        const response = await fetch(`${API_URL}/GetTours`);
        if (response.ok) {
            toursData = await response.json();
            toursData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderTourTree();
        }
    } catch (error) { 
        console.warn("Tours offline", error); 
        const container = document.getElementById('tours-tree-container');
        if(container) container.innerHTML = '<div class="alert alert-danger m-3">Konnte Touren nicht laden.</div>';
    }
}

async function loadForumData() {
    try {
        const catResponse = await fetch(`${API_URL}/forum`);
        allForumData = await catResponse.json();
        const threadResponse = await fetch(`${API_URL}/getThreads`); 
        if (threadResponse.ok) allThreadsCache = await threadResponse.json();
        
        if (!currentCategoryId && !currentForumTopic && getActivePage() === 'forum') {
            renderForumHome();
        }
    } catch (error) { console.error("Forum Fehler", error); }
}

async function loadFeed() {
    const container = document.getElementById('feed-posts');
    if (!container) return;
    if(allPostsCache.length === 0) container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-danger"></div></div>';

    try {
        const response = await fetch(`${API_URL}/getPosts`);
        if (!response.ok) throw new Error("Fehler beim Laden");
        const posts = await response.json();
        allPostsCache = posts;
        container.innerHTML = ""; 
        
        if (posts.length === 0) { 
            container.innerHTML = '<div class="text-center p-4 text-muted">Noch keine Beiträge.</div>'; 
            return; 
        }

        posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        posts.forEach(post => renderPostItem(post, container));
        
    } catch (error) { console.error(error); }
}

function renderPostItem(post, container) {
    const postId = post.id || post._id || post.rowKey; 
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const myUid = auth.currentUser ? auth.currentUser.uid : null;
    const likeClass = (myUid && likes.includes(myUid)) ? 'liked' : '';
    
    let mediaHtml = "";
    if (post.mediaUrl) {
        if (post.mediaType === 'video') mediaHtml = `<video src="${post.mediaUrl}" controls class="img-fluid rounded mt-2 w-100" style="max-height:500px;"></video>`;
        else mediaHtml = `<img src="${post.mediaUrl}" class="img-fluid rounded mt-2 w-100" style="max-height:500px; object-fit:cover;" loading="lazy">`;
    }

    let commentsHtml = '';
    comments.forEach(c => {
        commentsHtml += `<div class="comment-item"><div class="comment-bubble"><span class="comment-author">${c.user}</span>${c.text}<div class="text-end">${getDeleteBtn('comment', null, post.userId, postId, c.text, c.user)}</div></div></div>`;
    });

    const html = `
    <div class="card mb-4 border-0 shadow-sm" id="post-${postId}">
        <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center pt-3">
            <div class="d-flex align-items-center">
                <div style="width:40px; height:40px; background:#f0f2f5; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:10px; font-size:1.2rem;">👤</div>
                <div><div class="fw-bold text-dark" style="cursor:pointer;" onclick="openUserProfile('${post.userId}', '${post.user}')">${post.user || "Unbekannt"}</div><small class="text-muted">${new Date(post.createdAt).toLocaleDateString()}</small></div>
            </div>
            ${getDeleteBtn('post', postId, post.userId)}
        </div>
        <div class="card-body pt-1">
            <p class="card-text fs-5 mb-2">${post.content}</p>
            ${mediaHtml}
            <div class="d-flex justify-content-between text-muted small mt-3">
                <span id="like-count-${postId}">❤️ ${likes.length} Likes</span>
                <span style="cursor:pointer" onclick="document.getElementById('comments-${postId}').classList.toggle('show')">${comments.length} Kommentare</span>
            </div>
            <div class="post-actions">
                <button class="action-btn ${likeClass}" id="btn-like-${postId}" onclick="window.toggleLike('${postId}')">Gefällt mir</button>
                <button class="action-btn" onclick="document.getElementById('comments-${postId}').classList.toggle('show')">Kommentieren</button>
            </div>
            <div id="comments-${postId}" class="comment-section">
                <div id="comment-list-${postId}">${commentsHtml}</div>
                <div class="comment-input-wrapper">
                    <input type="text" id="input-comment-${postId}" class="form-control form-control-sm border-0" placeholder="Kommentar...">
                    <button class="btn btn-primary btn-sm rounded-pill px-3" onclick="window.postComment('${postId}')">➤</button>
                </div>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
}

/* ==========================================
   3. AUTH & USER SYNC
   ========================================== */

async function syncUserWithBackend(firebaseUser) {
    if (!firebaseUser) return; 
    try {
        const response = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                uid: firebaseUser.uid, 
                email: firebaseUser.email,
                displayName: firebaseUser.displayName 
            })
        });

        if(response.ok) {
            const dbUser = await response.json();
            if (currentUser) {
                currentUser.role = dbUser.role || "user";
                currentUser.bio = dbUser.bio || "";
                currentUser.photoUrl = dbUser.photoUrl || null;
                currentUser.friends = Array.isArray(dbUser.friends) ? dbUser.friends : [];
                currentRole = currentUser.role;
            }
            updateUI(); 
            if (getActivePage() === 'profile') renderProfilePage();
        }
    } catch (err) { console.warn("Backend Sync Fehler:", err); }
}

function updateUI() {
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const secureLinks = document.querySelectorAll('.auth-required');

    if (currentUser) {
        if(authBtn) authBtn.style.display = 'none'; 
        if(logoutBtn) logoutBtn.style.display = 'block';
        secureLinks.forEach(link => { link.classList.remove('d-none'); link.style.display = ''; });
        if(userInfo) {
            userInfo.style.display = 'block';
            const displayName = currentUser.displayName || currentUser.email.split('@')[0];
            userInfo.innerHTML = `Hallo, <b>${displayName}</b>`;
        }
    } else {
        if(authBtn) authBtn.style.display = 'block';     
        if(logoutBtn) logoutBtn.style.display = 'none';  
        if(userInfo) userInfo.style.display = 'none';    
        secureLinks.forEach(link => link.classList.add('d-none'));
    }
}

/* ==========================================
   4. NAVIGATION & PROFIL
   ========================================== */

function navigateTo(pageId) {
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(`page-${pageId}`);
    if (target) {
        target.classList.add('active');
        const navLink = document.getElementById(`nav-${pageId}`);
        if(navLink) navLink.classList.add('active');
        window.location.hash = pageId;

        if (pageId === 'forum') renderForumHome();
        if (pageId === 'profile') renderProfilePage();
        if (pageId === 'tours' && map) {
            setTimeout(() => { 
                map.invalidateSize(); 
                map.setView([51.16, 10.45], 6); 
                if (currentRouteLayer) map.removeLayer(currentRouteLayer);
            }, 200);
        }
    }
}
window.navigateTo = navigateTo;

window.openMyProfile = () => {
    viewingUserProfile = null; 
    navigateTo('profile');
};

function getActivePage() {
    return window.location.hash.replace('#', '') || 'home';
}

window.openUserProfile = (userId, userName) => {
    // Wenn Name nicht übergeben wurde, suchen wir ihn
    let display = userName;
    if(!display || display === 'undefined') {
        const info = findUserInfo(userId);
        display = info.name;
    }

    viewingUserProfile = { 
        uid: userId, 
        displayName: display, 
        isMe: (currentUser && currentUser.uid === userId) 
    };
    navigateTo('profile');
};

window.renderProfilePage = async () => {
    const container = document.getElementById('page-profile');
    if (!container) return;
    
    if (!viewingUserProfile && currentUser) {
        viewingUserProfile = { 
            uid: currentUser.uid, 
            displayName: currentUser.displayName || currentUser.email.split('@')[0], 
            isMe: true,
            bio: currentUser.bio || "",
            photoUrl: currentUser.photoUrl || null,
            friends: currentUser.friends || []
        };
    } 

    if (!viewingUserProfile) {
        container.innerHTML = '<div class="p-5 text-center">Lade Profil...</div>';
        return;
    }

    // HTML Gerüst prüfen
    if (!document.getElementById('profile-name')) {
        container.innerHTML = `
        <div style="height: 200px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); border-radius: 0 0 20px 20px;"></div>
        <div class="container" style="margin-top: -60px; position: relative; z-index: 10;">
            <div class="card border-0 shadow rounded-4 overflow-hidden bg-white">
                <div class="card-body p-4">
                    <div class="row align-items-end">
                        <div class="col-auto">
                            <div class="profile-pic-container">
                                <img src="" id="profile-img" class="rounded-circle border border-4 border-white shadow bg-white" style="width: 120px; height: 120px; object-fit: cover; background: #eee;">
                            </div>
                        </div>
                        <div class="col-md-6 mb-3 mb-md-0 pt-3 pt-md-0">
                            <h2 class="fw-bold mb-0 text-dark" id="profile-name"></h2>
                            <p class="text-muted mb-0" id="profile-bio"></p>
                            <div class="mt-4 pt-3 border-top">
                                <h6 class="fw-bold small text-uppercase text-muted mb-2">Freunde</h6>
                                <div id="friends-list-container" class="d-flex flex-wrap gap-2"></div>
                            </div>
                        </div>
                        <div class="col-md text-md-end pb-2" id="profile-actions"></div>
                    </div>
                    <hr class="my-4">
                    <div id="profile-stats-content">
                        <div class="text-center p-4 text-muted">Lade Aktivitäten...</div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    const nameEl = document.getElementById('profile-name');
    const bioEl = document.getElementById('profile-bio');
    const actionArea = document.getElementById('profile-actions');
    const statsArea = document.getElementById('profile-stats-content');
    const imgEl = document.getElementById('profile-img');
    const friendsContainer = document.getElementById('friends-list-container');

    if(imgEl) {
        imgEl.src = viewingUserProfile.photoUrl || `https://ui-avatars.com/api/?name=${viewingUserProfile.displayName}&background=random&size=128`;
    }
    if (nameEl) nameEl.innerText = viewingUserProfile.displayName;
    if (bioEl) bioEl.innerText = viewingUserProfile.bio || (viewingUserProfile.isMe ? currentUser.email : "Community Mitglied");

    // Freundesliste mit "Smart Lookup"
    if (friendsContainer) {
        // Nutze die Freunde vom AKTUELLEN User, wenn ich mein eigenes Profil ansehe
        let friends = viewingUserProfile.isMe ? (currentUser.friends || []) : (viewingUserProfile.friends || []);
        
        if (friends.length === 0) {
            friendsContainer.innerHTML = '<small class="text-muted fst-italic">Noch keine Freunde.</small>';
        } else {
            friendsContainer.innerHTML = '';
            const topFriends = friends.slice(0, 5);
            
            topFriends.forEach(friendId => {
                const info = findUserInfo(friendId); // HIER IST DER FIX FÜR "FAKE FREUNDE"
                const fName = info.name;
                const fImg = `https://ui-avatars.com/api/?name=${fName}&size=64&background=random&color=fff`;

                const badge = document.createElement('div');
                badge.className = 'd-flex align-items-center bg-light rounded-pill pe-3 p-1 border';
                badge.style.cursor = 'pointer';
                badge.onclick = () => openUserProfile(friendId, fName);
                badge.innerHTML = `<img src="${fImg}" class="rounded-circle me-2" width="30" height="30"><span class="small fw-bold text-dark">${fName}</span>`;
                friendsContainer.appendChild(badge);
            });
            if (friends.length > 5) {
                friendsContainer.innerHTML += `<span class="badge bg-secondary rounded-pill align-self-center">+${friends.length - 5}</span>`;
            }
        }
    }

    if (actionArea) {
        actionArea.innerHTML = '';
        if (viewingUserProfile.isMe) {
            actionArea.innerHTML = `<button class="btn btn-outline-secondary btn-sm" onclick="openEditProfile()">✏️ Profil bearbeiten</button>`;
        } else {
            const isFriend = currentUser && currentUser.friends && currentUser.friends.includes(viewingUserProfile.uid);
            if (isFriend) {
                actionArea.innerHTML = `<button class="btn btn-success btn-sm me-2" disabled>✔ Befreundet</button><button class="btn btn-dark btn-sm" onclick="openMessageModal('${viewingUserProfile.displayName}')">💬 Nachricht</button>`;
            } else {
                actionArea.innerHTML = `<button class="btn btn-danger btn-sm me-2" onclick="addFriend('${viewingUserProfile.uid}')">🤝 Freund+</button><button class="btn btn-dark btn-sm" onclick="openMessageModal('${viewingUserProfile.displayName}')">💬 Nachricht</button>`;
            }
        }
    }

    // Statistiken
    if (statsArea) {
        const targetName = viewingUserProfile.displayName;
        const myTours = toursData.filter(t => t.user === targetName);
        const myPosts = allPostsCache.filter(p => p.user === targetName);
        
        let html = `<div class="d-flex gap-3 mb-4 justify-content-center text-center">
                        <div class="bg-light p-2 rounded px-3"><b>${myTours.length}</b><br><small>Touren</small></div>
                        <div class="bg-light p-2 rounded px-3"><b>${myPosts.length}</b><br><small>Beiträge</small></div>
                    </div>`;
        
        if (myTours.length > 0) {
            html += `<h6 class="fw-bold mt-3">🏍️ Touren</h6><div class="list-group mb-3">`;
            myTours.forEach(t => html += `<a href="#" onclick="selectTour('${t.id}'); navigateTo('tours');" class="list-group-item list-group-item-action border-0 border-bottom">${t.title}</a>`);
            html += `</div>`;
        }
        statsArea.innerHTML = html;
    }
};

window.addFriend = async (targetUid) => {
    if (!currentUser) return window.showToast("Bitte einloggen", true);
    if (targetUid === currentUser.uid) return window.showToast("Du kannst dich nicht selbst adden", true);

    if (!currentUser.friends) currentUser.friends = [];
    
    if (!currentUser.friends.includes(targetUid)) {
        currentUser.friends.push(targetUid);
        
        // Optimistisches Update
        const btn = document.querySelector('button[onclick*="addFriend"]');
        if(btn) { btn.className = "btn btn-success btn-sm me-2"; btn.innerHTML = "✔ Befreundet"; btn.disabled = true; }
        
        // Speichern
        try {
            const formData = new FormData();
            formData.append('uid', currentUser.uid);
            formData.append('friends', JSON.stringify(currentUser.friends));
            formData.append('bio', currentUser.bio || "");
            await fetch(`${API_URL}/updateUser`, { method: 'POST', body: formData });
            window.showToast("Freund hinzugefügt!");
        } catch (e) { 
            console.error(e); 
            window.showToast("Fehler beim Speichern (Lokal ok)", true);
        }
    } else {
        window.showToast("Bereits befreundet.");
    }
};

/* ==========================================
   5. INTERACTIVE FUNCTIONS
   ========================================== */

window.createPost = async () => {
    if (!auth.currentUser) return window.showToast("Bitte erst anmelden", true);
    const textInput = document.getElementById('postInputText');
    const fileInput = document.getElementById('postInputFile');
    const submitBtn = document.querySelector('button[onclick="window.createPost()"]');

    if (!textInput.value.trim() && fileInput.files.length === 0) return window.showToast("Bitte Text eingeben", true);

    submitBtn.disabled = true;
    try {
        const formData = new FormData();
        formData.append('username', auth.currentUser.displayName || "Biker");
        formData.append('content', textInput.value);
        if (fileInput.files.length > 0) formData.append('media', fileInput.files[0]);

        const response = await fetch(`${API_URL}/createPost`, {
            method: 'POST', headers: { 'x-user-id': auth.currentUser.uid }, body: formData 
        });

        if (response.ok) {
            await loadFeed();
            window.showToast("Beitrag erstellt!");
            textInput.value = ""; fileInput.value = "";
        }
    } catch (error) { window.showToast("Netzwerkfehler", true); } 
    finally { submitBtn.disabled = false; }
};

window.toggleLike = async (postId) => {
    if (!auth.currentUser) return window.showToast("Bitte einloggen", true);
    const btn = document.getElementById(`btn-like-${postId}`);
    const countSpan = document.getElementById(`like-count-${postId}`);
    const isLiked = btn.classList.contains('liked');
    btn.classList.toggle('liked');
    let currentCount = parseInt(countSpan.innerText.replace(/\D/g, '')) || 0;
    countSpan.innerText = `❤️ ${isLiked ? currentCount - 1 : currentCount + 1} Likes`;
    try { await fetch(`${API_URL}/toggleLike`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ postId, userId: auth.currentUser.uid }) }); } catch(e){}
};

window.postComment = async (postId) => {
    if (!auth.currentUser) return window.showToast("Bitte einloggen", true);
    const input = document.getElementById(`input-comment-${postId}`);
    const text = input.value.trim();
    if (!text) return;
    const list = document.getElementById(`comment-list-${postId}`);
    const user = auth.currentUser.displayName || "Ich";
    list.insertAdjacentHTML('beforeend', `<div class="comment-item"><div class="comment-bubble"><span class="comment-author">${user}</span>${text}</div></div>`);
    input.value = ""; 
    try { await fetch(`${API_URL}/addComment`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ postId, text, user }) }); } catch(e){}
};

window.deleteItem = async (type, id, partitionKey, parentId = null, commentText = null, commentUser = null) => {
    if (!confirm("Löschen bestätigen?")) return;
    try {
        const response = await fetch(`${API_URL}/deleteItem`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, id, partitionKey, parentId, commentText, commentUser })
        });
        if (response.ok) {
            window.showToast("Gelöscht!");
            if (type === 'tour') loadToursFromServer();
            else if (type === 'post') loadFeed();
            else if (type === 'thread') renderForumSubCategory(currentCategoryId);
            else if (type === 'reply') renderThreadDetail(parentId, currentForumTopic, currentCategoryId);
            else if (type === 'topic') renderForumSubCategory(currentCategoryId);
        } else { window.showToast("Fehler beim Löschen", true); }
    } catch (e) { window.showToast("Server Fehler", true); }
};

function getDeleteBtn(type, id, partitionKey, parentId=null, text=null, user=null) {
    if (currentRole !== 'admin') return "";
    const formatArg = (val) => val ? `'${val.toString().replace(/'/g, "\\'").replace(/\n/g, " ")}'` : 'null';
    return `<button class="btn btn-sm btn-outline-danger border-0 ms-2" onclick="event.stopPropagation(); deleteItem('${type}', ${formatArg(id)}, ${formatArg(partitionKey)}, ${formatArg(parentId)}, ${formatArg(text)}, ${formatArg(user)})">🗑️</button>`;
}

// --- MODALS & EXTRAS ---
window.openEditProfile = () => {
    const bioText = document.getElementById('profile-bio')?.innerText || "";
    const bioInput = document.getElementById('editProfileBio');
    if (bioInput) bioInput.value = bioText;
    new bootstrap.Modal(document.getElementById('editProfileModal')).show();
};

window.previewProfileImage = (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById('edit-preview-img').src = e.target.result;
        reader.readAsDataURL(file);
    }
};

window.saveProfile = async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('editProfilePic');
    const newBio = document.getElementById('editProfileBio').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true; 
    submitBtn.innerText = "Speichere...";

    try {
        const formData = new FormData();
        formData.append('uid', currentUser.uid);
        formData.append('bio', newBio);
        if (fileInput.files.length > 0) formData.append('profilePic', fileInput.files[0]);

        const response = await fetch(`${API_URL}/updateUser`, { method: 'POST', body: formData });
        if (response.ok) {
            const updatedUser = await response.json();
            currentUser.bio = updatedUser.bio || newBio;
            if (updatedUser.photoUrl) currentUser.photoUrl = updatedUser.photoUrl;
            viewingUserProfile = { ...viewingUserProfile, ...currentUser, isMe: true };
            renderProfilePage();
            bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
            window.showToast("✅ Profil gespeichert!");
        } else { window.showToast("Fehler", true); }
    } catch (err) { window.showToast("Netzwerkfehler", true); } 
    finally { submitBtn.disabled = false; submitBtn.innerText = "Speichern"; }
};

window.openMessageModal = (name) => {
    document.getElementById('msg-recipient').innerText = name;
    new bootstrap.Modal(document.getElementById('messageModal')).show();
};

window.sendMessage = () => {
    window.showToast("Nachricht gesendet!");
    bootstrap.Modal.getInstance(document.getElementById('messageModal')).hide();
    document.getElementById('msg-text').value = "";
};

window.openNewThreadModal = () => { document.getElementById('threadTopicDisplay').value = currentForumTopic; new bootstrap.Modal(document.getElementById('createThreadModal')).show(); };
window.openAddCategoryModal = (id) => { document.getElementById('mainCatIdInput').value = id; new bootstrap.Modal(document.getElementById('addCategoryModal')).show(); };
window.insertPostEmoji = (e) => { const i = document.getElementById('postInputText'); i.value+=e; i.focus(); };
window.insertEmoji = (e) => { const i = document.getElementById('threadText'); i.value+=e; i.focus(); };

// --- MAP & TOURS ---
function initMap() { 
    if (map) return; 
    const mapContainer = document.getElementById('map'); 
    if (!mapContainer) return; 
    map = L.map('map').setView([51.16, 10.45], 6); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map); 
}

function renderTourTree() { 
    const container = document.getElementById('tours-tree-container'); 
    if (!container) return; 
    container.innerHTML = ''; 
    if (toursData.length === 0) { container.innerHTML = '<div class="p-4 text-center text-muted">Keine Touren.</div>'; return; } 
    const groups = {}; 
    toursData.forEach(t => { 
        if (!groups[t.category]) groups[t.category] = {}; 
        if (!groups[t.category][t.country]) groups[t.category][t.country] = []; 
        groups[t.category][t.country].push(t); 
    }); 
    let html = `<div class="accordion accordion-flush" id="accReg">`; 
    Object.keys(groups).sort().forEach((reg, i) => { 
        html += `<div class="accordion-item bg-transparent"><h2 class="accordion-header" id="h${i}"><button class="accordion-button ${i===0?'':'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#c${i}">🌍 ${reg}</button></h2><div id="c${i}" class="accordion-collapse collapse ${i===0?'show':''}" data-bs-parent="#accReg"><div class="accordion-body p-0">`; 
        Object.keys(groups[reg]).sort().forEach(ctry => { 
            html += `<div class="bg-light p-2 ps-3 fw-bold border-bottom border-top"><small>🏳️ ${ctry}</small></div><div class="list-group list-group-flush">`; 
            groups[reg][ctry].forEach(t => { 
                let action = t.routeGeometry ? `<button class="btn btn-link btn-sm p-0" onclick="event.stopPropagation(); downloadGPX('${t.id}')">💾 GPX</button>` : "";
                let del = getDeleteBtn('tour', t.id, t.id);
                html += `<div class="list-group-item list-group-item-action p-3" onclick="selectTour('${t.id}')" style="cursor:pointer;"><div class="d-flex justify-content-between"><h6 class="fw-bold mb-1 text-primary text-truncate">${t.title}</h6><small>${t.km} km</small></div><small class="text-muted">von <b onclick="event.stopPropagation(); openUserProfile('${t.userId}', '${t.user}')" class="text-primary" style="cursor:pointer">${t.user}</b></small><div class="float-end">${action}${del}</div></div>`; 
            }); 
            html += `</div>`; 
        }); 
        html += `</div></div></div>`; 
    }); 
    container.innerHTML = html + `</div>`; 
}

window.selectTour = (id) => { 
    const t = toursData.find(x => x.id === id);
    if (!t) return;
    if (currentRouteLayer) map.removeLayer(currentRouteLayer);
    if (t.coords) map.flyTo(t.coords, 11);
    if (t.routeGeometry) { 
        currentRouteLayer = L.polyline(t.routeGeometry, { color: 'red', weight: 5 }).addTo(map); 
        map.fitBounds(currentRouteLayer.getBounds()); 
    } 
};

window.handleGpxFileSelect = (event) => { 
    const file = event.target.files[0]; 
    if (!file) return; 
    const reader = new FileReader(); 
    reader.onload = (e) => {
        const parser = new DOMParser(); 
        const xmlDoc = parser.parseFromString(e.target.result, "text/xml"); 
        const trkpts = xmlDoc.getElementsByTagName("trkpt"); 
        if (trkpts.length === 0) return alert("Fehler: GPX leer."); 
        let coordinates = [], totalDist = 0; 
        for (let i = 0; i < trkpts.length; i++) { 
            const lat = parseFloat(trkpts[i].getAttribute("lat")); 
            const lon = parseFloat(trkpts[i].getAttribute("lon")); 
            coordinates.push([lat, lon]); 
            if (i > 0) { 
                const p = coordinates[i - 1]; 
                totalDist += 12742 * Math.asin(Math.sqrt(0.5 - Math.cos((lat - p[0]) * Math.PI / 180)/2 + Math.cos(p[0] * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * (1 - Math.cos((lon - p[1]) * Math.PI / 180))/2)); 
            } 
        } 
        document.getElementById('newKm').value = totalDist.toFixed(1); 
        document.getElementById('btn-publish-tour').disabled = false; 
        tempGpxData = { routeGeometry: coordinates, coords: coordinates[0], km: totalDist.toFixed(1) };
    };
    reader.readAsText(file); 
};

async function handleAddTour(e) { 
    e.preventDefault(); 
    if (!currentUser || !tempGpxData) return;
    const newTour = { 
        title: document.getElementById('newTitle').value, 
        category: document.getElementById('newRegion').value, 
        country: document.getElementById('newCountry').value, 
        state: document.getElementById('newState').value, 
        desc: document.getElementById('newDesc').value, 
        time: document.getElementById('newTime').value, 
        km: tempGpxData.km, coords: tempGpxData.coords, 
        routeGeometry: tempGpxData.routeGeometry, 
        user: currentUser.displayName, userId: currentUser.uid,
        createdAt: new Date().toISOString() 
    }; 
    try { 
        await fetch(API_URL + '/addTour', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newTour) }); 
        loadToursFromServer();
        bootstrap.Modal.getInstance(document.getElementById('addTourModal')).hide(); 
        window.showToast("Tour hochgeladen!");
    } catch (err) { window.showToast("Fehler", true); } 
}

window.downloadGPX = (id) => { 
    const t = toursData.find(x => x.id === id); 
    if (!t) return;
    let gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>${t.title}</name><trkseg>`; 
    t.routeGeometry.forEach(pt => gpx += `<trkpt lat="${pt[0]}" lon="${pt[1]}"></trkpt>`); 
    gpx += `</trkseg></trk></gpx>`; 
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' })); 
    a.download = `${t.title}.gpx`; 
    a.click(); 
};

// --- EVENTS ---
function setupEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', async () => { await signOut(auth); window.location.reload(); });
    document.getElementById('authForm').addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const isReg = document.getElementById('authNameContainer').style.display === 'block'; 
        if (isReg) handleRegister(); else handleLogin(e); 
    });
    
    // Auth Handlers
    async function handleRegister() {
        const name = document.getElementById('authName').value;
        try {
            const cred = await createUserWithEmailAndPassword(auth, document.getElementById('authEmail').value, document.getElementById('authPass').value);
            await updateProfile(cred.user, { displayName: name });
            window.location.reload();
        } catch(e) { document.getElementById('auth-message').innerText = e.message; }
    }
    async function handleLogin() {
        try {
            await signInWithEmailAndPassword(auth, document.getElementById('authEmail').value, document.getElementById('authPass').value);
            bootstrap.Modal.getInstance(document.getElementById('authModal')).hide();
        } catch(e) { document.getElementById('auth-message').innerText = "Login fehlgeschlagen"; }
    }
}