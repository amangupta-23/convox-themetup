// Saari zaroori Node.js libraries ko import karein
import express from 'express'; // Web server framework
import mongoose from 'mongoose'; // MongoDB se connect karne ke liye
import { createServer } from 'http'; // HTTP server banane ke liye
import { Server } from 'socket.io'; // Real-time communication ke liye
import cors from 'cors'; // Cross-Origin Resource Sharing ko handle karne ke liye
import dotenv from 'dotenv'; // Environment variables (.env file se) load karne ke liye
import { v4 as uuidv4 } from 'uuid'; // Unique meeting ID banane ke liye
import path from 'path'; // File paths ko handle karne ke liye
import { fileURLToPath } from 'url'; // ESM modules mein __dirname aur __filename ko define karne ke liye

// `__dirname` aur `__filename` ko setup karein
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env file se environment variables load karein
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();

// --- CORS Configuration (Express App) ---
// Sirf Netlify site se aane wali requests ko allow karein.
// Aapki Netlify site ka URL yahaan par daalein.
const NETLIFY_ORIGIN = 'https://convoxthemetup.netlify.app';

const corsOptions = {
    origin: NETLIFY_ORIGIN
};

app.use(cors(corsOptions));
app.use(express.json());

// MongoDB Connection & Schema
console.log('MONGO_URI from env:', process.env.MONGO_URI ? 'Set' : 'Not Set');
// Environment variable se MongoDB URI lein, agar na mile to local URI use karein
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/videocall';

// MongoDB se connect karein
mongoose
    .connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected!'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err.message);
    });

// MongoDB schema for meetings
const { Schema, model } = mongoose;

const meetingSchema = new Schema({
    meetingId: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    users: [
        { name: { type: String, required: true }, email: { type: String, required: true } },
    ],
});

const Meeting = model('Meeting', meetingSchema);

// --- Socket.IO Server Setup ---
const server = createServer(app);
// Socket.IO ke liye bhi CORS configure karein
const io = new Server(server, {
    cors: {
        origin: NETLIFY_ORIGIN,
        methods: ['GET', 'POST']
    }
});

// Global states to manage users and their connections
const userSocketMap = new Map();
const emailToSocketIdMap = new Map();

// Express API Routes

// API to Create a new Meeting ID
app.get('/create-meeting', async (req, res) => {
    try {
        const meetingId = uuidv4();
        const newMeeting = new Meeting({ meetingId, users: [] });
        await newMeeting.save();
        console.log(`New meeting created: ${meetingId}`);
        res.json({ meetingId });
    } catch (error) {
        console.error("Error creating meeting:", error);
        res.status(500).json({ error: "Failed to create meeting." });
    }
});

// API to Validate a Meeting ID before a user joins
app.post('/join-meeting', async (req, res) => {
    const { meetingId } = req.body;
    try {
        const meeting = await Meeting.findOne({ meetingId });
        if (meeting) {
            return res.status(200).json({ success: true, message: 'Meeting found' });
        } else {
            return res.status(404).json({ error: 'Meeting ID not found.' });
        }
    } catch (error) {
        console.error("Error checking meeting:", error);
        res.status(500).json({ error: "Server error during join check." });
    }
});

// Socket.IO Signaling Logic (WebRTC ke liye)
io.on('connection', socket => {
    console.log(`New user connected: ${socket.id}`);

    // Jab user room join kare
    socket.on('join-room', async ({ meetingId, name, email }) => {
        let meeting = await Meeting.findOne({ meetingId });
        if (!meeting) {
            socket.emit('meeting-not-found');
            return;
        }

        // Database mein user add karein agar pehle se nahi hai
        if (!meeting.users.some(u => u.email === email)) {
            meeting.users.push({ name, email });
            await meeting.save();
        }

        // User ko Socket.IO room mein join karein
        socket.join(meetingId);
        userSocketMap.set(socket.id, { name, email, meetingId });
        emailToSocketIdMap.set(email, socket.id);

        console.log(`${name} joined meeting: ${meetingId}`);

        // Room ke existing participants ki list banayein
        const existingParticipants = [];
        const socketsInRoom = await io.in(meetingId).fetchSockets();

        socketsInRoom.forEach(s => {
            if (s.id !== socket.id) {
                const userInfo = userSocketMap.get(s.id);
                if (userInfo) {
                    existingParticipants.push({ name: userInfo.name, email: userInfo.email, socketId: s.id });
                }
            }
        });

        // Naye user ko existing participants ki list bhejein
        socket.emit('existing-participants', existingParticipants);

        // Room ke baaki users ko naye user ke baare mein batayein
        socket.to(meetingId).emit('user-connected', { name, email, socketId: socket.id });
    });

    // WebRTC Signaling Events

    // User A, User B ko call kar raha hai (SDP Offer)
    socket.on('call-user', ({ offer, toSocketId }) => {
        const fromUserInfo = userSocketMap.get(socket.id);
        
        io.to(toSocketId).emit('incoming-call', {
            offer,
            from: socket.id,
            fromName: fromUserInfo ? fromUserInfo.name : 'Unknown',
        });
    });

    // User B, User A ke call ka jawab de raha hai (SDP Answer)
    socket.on('make-answer', ({ answer, toSocketId }) => {
        io.to(toSocketId).emit('answer-made', {
            answer,
            from: socket.id,
        });
    });

    // ICE Candidates ka exchange (Network information)
    socket.on('ice-candidate', ({ candidate, toSocketId }) => {
        io.to(toSocketId).emit('ice-candidate', {
            candidate,
            from: socket.id,
        });
    });

    // Jab koi user disconnect ho
    socket.on('disconnect', () => {
        const userInfo = userSocketMap.get(socket.id);
        if (userInfo) {
            console.log(`${userInfo.name} disconnected from: ${userInfo.meetingId}`);
            
            userSocketMap.delete(socket.id);
            emailToSocketIdMap.delete(userInfo.email);

            // Room ke baaki users ko batayein ki user disconnect ho gaya hai
            socket.to(userInfo.meetingId).emit('user-disconnected', { 
                socketId: socket.id
            });
        }
    });
});

// Server ko chalu karein
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
