const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Initialize users
const USERS = {
    Gauri: {
        username: 'Gauri',
        password: hashPassword('18072007'),
        isOnline: false,
        lastSeen: null,
        socketId: null
    },
    Btye: {
        username: 'Btye',
        password: hashPassword('18042004'),
        isOnline: false,
        lastSeen: null,
        socketId: null
    }
};

// Hash password function
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Load or initialize data
function loadData() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const userData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            Object.assign(USERS, userData);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(USERS, null, 2));
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
    return [];
}

function saveMessages(messages) {
    try {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    } catch (error) {
        console.error('Error saving messages:', error);
    }
}

// Initialize data
loadData();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = USERS[username];
    if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token;
    saveUsers();
    
    res.json({ 
        success: true, 
        token, 
        username: user.username 
    });
});

app.post('/logout', (req, res) => {
    const { token } = req.body;
    
    // Find user by token and clear it
    Object.values(USERS).forEach(user => {
        if (user.token === token) {
            user.token = null;
            user.isOnline = false;
            user.lastSeen = Date.now();
            user.socketId = null;
        }
    });
    
    saveUsers();
    res.json({ success: true });
});

app.get('/messages', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = Object.values(USERS).find(u => u.token === token);
    
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const messages = loadMessages();
    res.json(messages);
});

app.post('/clear-chat', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = Object.values(USERS).find(u => u.token === token);
    
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    saveMessages([]);
    
    // Notify all connected clients
    io.emit('chat_cleared');
    
    res.json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('authenticate', (token) => {
        const user = Object.values(USERS).find(u => u.token === token);
        if (user) {
            user.isOnline = true;
            user.socketId = socket.id;
            user.lastSeen = null;
            socket.username = user.username;
            
            saveUsers();
            
            // Send user status to all clients
            io.emit('user_status', {
                username: user.username,
                isOnline: true,
                lastSeen: null
            });
            
            // Send current online users
            const onlineUsers = Object.values(USERS)
                .filter(u => u.isOnline)
                .map(u => ({
                    username: u.username,
                    isOnline: true,
                    lastSeen: u.lastSeen
                }));
            
            socket.emit('online_users', onlineUsers);
        }
    });
    
    socket.on('send_message', (data) => {
        const user = Object.values(USERS).find(u => u.socketId === socket.id);
        if (!user) return;
        
        const message = {
            id: Date.now().toString(),
            sender: user.username,
            content: data.content,
            timestamp: Date.now(),
            type: 'text'
        };
        
        const messages = loadMessages();
        messages.push(message);
        saveMessages(messages);
        
        // Send message to all connected clients
        io.emit('new_message', message);
    });
    
    socket.on('typing', (data) => {
        const user = Object.values(USERS).find(u => u.socketId === socket.id);
        if (!user) return;
        
        socket.broadcast.emit('user_typing', {
            username: user.username,
            isTyping: data.isTyping
        });
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Update user status
        const user = Object.values(USERS).find(u => u.socketId === socket.id);
        if (user) {
            user.isOnline = false;
            user.lastSeen = Date.now();
            user.socketId = null;
            
            saveUsers();
            
            // Notify other users
            io.emit('user_status', {
                username: user.username,
                isOnline: false,
                lastSeen: user.lastSeen
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the chat`);
});
