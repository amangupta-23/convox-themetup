import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

// --- Removed: const express = require('express'); (etc.) ---

const app = express();

// Allow requests only from your Netlify site
const corsOptions = {
    origin: 'https://convoxthemetup.netlify.app'
};

app.use(cors(corsOptions));
app.use(express.json());

// Static files (index.html, meeting.html, CSS, etc.) public folder se serve honge
app.use(express.static(path.join(__dirname, 'public')));


// MongoDB Connection & Schema
console.log('MONGO_URI from env:', process.env.MONGO_URI ? 'Set' : 'Not Set');
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/videocall';

mongoose
    .connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected!'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err.message);
    });

const { Schema, model } = mongoose;

const meetingSchema = new Schema({
    meetingId: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    users: [
        { name: { type: String, required: true }, email: { type: String, required: true } },
    ],
});

const Meeting = model('Meeting', meetingSchema);

const server = createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Global state to track active users and their location/info
const userSocketMap = new Map();
const emailToSocketIdMap = new Map();

// Express API Routes

// 1. Root route: Landing Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Meeting Page (Accessed via redirect after join form submission)
app.get('/meeting.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'meeting.html'));
});

// 3. API to Create Meeting ID
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

// 4. API to Validate Meeting ID before Join
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

// Socket.IO Signaling Logic
io.on('connection', socket => {
    console.log(`New user connected: ${socket.id}`);

    // 1. User joins the room (Initial setup)
    socket.on('join-room', async ({ meetingId, name, email }) => {
        let meeting = await Meeting.findOne({ meetingId });
        if (!meeting) {
            socket.emit('meeting-not-found');
            return;
        }

        // Add user to DB if not already there
        if (!meeting.users.some(u => u.email === email)) {
            meeting.users.push({ name, email });
            await meeting.save();
        }

        socket.join(meetingId);
        userSocketMap.set(socket.id, { name, email, meetingId });
        emailToSocketIdMap.set(email, socket.id);

        console.log(`${name} joined meeting: ${meetingId}`);

        // Get all current ACTIVE sockets in the room (Filter out the current user)
        const existingParticipants = [];
        
        // Loop through all sockets in the room and compile their info
        const socketsInRoom = await io.in(meetingId).fetchSockets();

        socketsInRoom.forEach(s => {
            if (s.id !== socket.id) {
                const userInfo = userSocketMap.get(s.id);
                if (userInfo) {
                    existingParticipants.push({ name: userInfo.name, email: userInfo.email, socketId: s.id });
                }
            }
        });

        // 1. Send existing participants to the newly joined user
        socket.emit('existing-participants', existingParticipants);

        // 2. Notify other users in room about the new user
        socket.to(meetingId).emit('user-connected', { name, email, socketId: socket.id });
    });

    // WebRTC Signaling Events

    // 1. User A wants to call User B (sends SDP Offer)
    socket.on('call-user', ({ offer, toSocketId }) => {
        const fromUserInfo = userSocketMap.get(socket.id);
        
        io.to(toSocketId).emit('incoming-call', {
            offer,
            from: socket.id,
            fromName: fromUserInfo ? fromUserInfo.name : 'Unknown',
        });
    });

    // 2. User B answers the call from User A (sends SDP Answer)
    socket.on('make-answer', ({ answer, toSocketId }) => {
        io.to(toSocketId).emit('answer-made', {
            answer,
            from: socket.id,
        });
    });

    // 3. Exchange ICE Candidates (Network information)
    socket.on('ice-candidate', ({ candidate, toSocketId }) => {
        io.to(toSocketId).emit('ice-candidate', {
            candidate,
            from: socket.id,
        });
    });

    // Disconnect Handler

    socket.on('disconnect', () => {
        const userInfo = userSocketMap.get(socket.id);
        if (userInfo) {
            console.log(`${userInfo.name} disconnected from: ${userInfo.meetingId}`);
            
            // Remove from maps
            userSocketMap.delete(socket.id);
            emailToSocketIdMap.delete(userInfo.email);

            // Notify everyone in the room
            socket.to(userInfo.meetingId).emit('user-disconnected', { 
                socketId: socket.id
            });
        }
    });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
