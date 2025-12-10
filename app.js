// Sample posts data
let posts = [
    {
        id: 1,
        author: "Lisa Motorrad",
        avatar: "LM",
        time: "vor 2 Stunden",
        content: "Gerade eine fantastische Tour durch den Schwarzwald beendet! 285km pure Fahrspaß. Die Kurven waren der Hammer! 🏍️🌲",
        likes: 45,
        comments: 12,
        shares: 3
    },
    {
        id: 2,
        author: "Tom Kurven",
        avatar: "TK",
        time: "vor 5 Stunden",
        content: "Wer ist nächstes Wochenende dabei? Plane eine Tour zu den Alpen. Start Samstag 6 Uhr! 🏔️",
        likes: 28,
        comments: 8,
        shares: 5
    },
    {
        id: 3,
        author: "Sarah Kawasaki",
        avatar: "SK",
        time: "vor 8 Stunden",
        content: "Endlich meine neue Kawasaki Ninja abgeholt! Die ersten 100km sind gefahren und ich bin verliebt 😍💚",
        likes: 67,
        comments: 23,
        shares: 2
    }
];

// Navigation functionality
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Remove active class from all links
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        
        // Add active class to clicked link
        this.classList.add('active');
        
        // Get the target page
        const target = this.getAttribute('href').substring(1);
        
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        
        // Show target page
        if (target === 'home') {
            document.getElementById('home-page').classList.add('active');
        } else if (target === 'profile') {
            document.getElementById('profile-page').classList.add('active');
        }
    });
});

// Tab functionality for profile page
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        // Remove active class from all tabs
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        // Add active class to clicked tab
        this.classList.add('active');
        
        // Show corresponding content
        const tabId = this.getAttribute('data-tab') + '-tab';
        document.getElementById(tabId).classList.add('active');
    });
});

// Create post functionality
const postInput = document.getElementById('postInput');
const postBtn = document.getElementById('postBtn');
const feedPosts = document.getElementById('feed-posts');

// Function to create a post card
function createPostCard(post) {
    const postCard = document.createElement('div');
    postCard.className = 'post-card';
    postCard.innerHTML = `
        <div class="post-header">
            <div class="post-user-info">
                <div class="user-avatar">${post.avatar}</div>
                <div class="post-user-details">
                    <h4>${post.author}</h4>
                    <span class="post-time">${post.time}</span>
                </div>
            </div>
        </div>
        <div class="post-content">
            ${post.content}
        </div>
        <div class="post-actions-bar">
            <div class="post-action">
                <span>👍</span>
                <span>${post.likes} Likes</span>
            </div>
            <div class="post-action">
                <span>💬</span>
                <span>${post.comments} Kommentare</span>
            </div>
            <div class="post-action">
                <span>🔄</span>
                <span>${post.shares} Teilen</span>
            </div>
        </div>
    `;
    
    // Add like functionality
    const likeBtn = postCard.querySelector('.post-action:first-child');
    likeBtn.addEventListener('click', function() {
        post.likes++;
        this.querySelector('span:last-child').textContent = `${post.likes} Likes`;
        this.style.color = 'var(--primary-color)';
    });
    
    return postCard;
}

// Load initial posts
function loadPosts() {
    feedPosts.innerHTML = '';
    posts.forEach(post => {
        feedPosts.appendChild(createPostCard(post));
    });
}

// Post button click handler
postBtn.addEventListener('click', function() {
    const content = postInput.value.trim();
    
    if (content) {
        const newPost = {
            id: posts.length + 1,
            author: "Max Rider",
            avatar: "MR",
            time: "gerade eben",
            content: content,
            likes: 0,
            comments: 0,
            shares: 0
        };
        
        // Add post to beginning of array
        posts.unshift(newPost);
        
        // Clear input
        postInput.value = '';
        
        // Reload posts
        loadPosts();
        
        // Scroll to top of feed
        feedPosts.scrollIntoView({ behavior: 'smooth' });
    }
});

// Allow posting with Enter key
postInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        postBtn.click();
    }
});

// Quick links functionality
document.querySelectorAll('.quick-links li').forEach(link => {
    link.addEventListener('click', function() {
        alert('Feature "' + this.textContent + '" wird bald verfügbar sein!');
    });
});

// Active users click functionality
document.querySelectorAll('.active-user').forEach(user => {
    user.addEventListener('click', function() {
        const userName = this.querySelector('.user-name-small').textContent;
        alert('Profil von ' + userName + ' öffnen (Feature kommt bald!)');
    });
});

// Popular tours click functionality
document.querySelectorAll('.tour-item').forEach(tour => {
    tour.addEventListener('click', function() {
        const tourName = this.querySelector('span:first-child').textContent;
        alert('Tour "' + tourName + '" öffnen (Feature kommt bald!)');
    });
});

// Edit profile button
const editProfileBtn = document.querySelector('.edit-profile-btn');
if (editProfileBtn) {
    editProfileBtn.addEventListener('click', function() {
        alert('Profil bearbeiten (Feature kommt bald!)');
    });
}

// Friend cards click functionality
document.querySelectorAll('.friend-card').forEach(card => {
    card.addEventListener('click', function() {
        const friendName = this.querySelector('span').textContent;
        alert('Profil von ' + friendName + ' öffnen (Feature kommt bald!)');
    });
});

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    loadPosts();
    console.log('BikerConnect geladen! 🏍️');
});

// Add some interactivity to post action buttons
document.addEventListener('click', function(e) {
    if (e.target.closest('.post-action-btn')) {
        const btn = e.target.closest('.post-action-btn');
        const action = btn.textContent.trim();
        alert(action + ' - Feature kommt bald!');
    }
});