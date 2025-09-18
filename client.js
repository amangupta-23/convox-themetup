// ===================================
// public/client.js (FINAL CODE)
// ===================================

// Browser compatibility check ke liye
const RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;

const socket = io(); // Connects to the Socket.IO server

const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; // Local video should be muted for self
myVideo.id = 'my-video'; // ID for easy targeting
const peers = {}; // To store all RTCPeerConnection objects (peers[socketId] = peerConnection)

// ----------------------------------------------------
// 1. STUN/TURN Server Configuration (Mandatory for WebRTC)
// ----------------------------------------------------
const configuration = {
    iceServers: [
        // Google's public STUN server (Helps discover public IP)
        { urls: 'stun:stun.l.google.com:19302' },
        // Add TURN servers here if needed for restrictive networks
    ]
};

let localStream;

// A function to set up the media stream and join the room
async function startMedia(meetingId, name, email) {
    if (!meetingId || !name || !email) {
        console.error("Meeting details are missing.");
        alert("Please provide Meeting ID, Name, and Email.");
        return;
    }

    try {
        // 1. Get local media (camera and microphone)
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addVideoStream(myVideo, localStream);

        // 2. Inform server that this user has joined and is ready
        socket.emit('join-room', { meetingId, name, email });

    } catch (err) {
        console.error('❌ Error accessing media:', err);
        alert('Could not get access to your camera and microphone! Please check permissions.');
    }
}

// Function to display the video stream in the HTML
function addVideoStream(videoElement, stream) {
    videoElement.srcObject = stream;
    videoElement.addEventListener('loadedmetadata', () => {
        videoElement.play();
    });
    // Add appropriate classes for styling (optional)
    videoElement.classList.add('video-participant'); 
    videoGrid.append(videoElement);
}

// ----------------------------------------------------
// Core WebRTC Peer Connection Setup function
// ----------------------------------------------------
function createPeerConnection(targetSocketId, isNewUserJoining = false) {
    const peer = new RTCPeerConnection(configuration);
    peers[targetSocketId] = peer;

    // Add local tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
        });
    }

    // --- Event 1: Receiving Remote Stream ---
    // When remote stream is received, display it
    peer.ontrack = (event) => {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `video-${targetSocketId}`;
        remoteVideo.classList.add('remote-video');
        addVideoStream(remoteVideo, event.streams[0]);
        console.log(`✅ Remote stream from ${targetSocketId} received.`);
    };

    // --- Event 2: ICE Candidate Exchange ---
    // Handle ICE candidates and send them via server
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                toSocketId: targetSocketId
            });
            // console.log(`ICE Candidate sent to ${targetSocketId}`);
        }
    };
    
    // Optional: Log connection state changes for debugging
    peer.onconnectionstatechange = (event) => {
        console.log(`Connection state with ${targetSocketId}: ${peer.connectionState}`);
    };

    return peer;
}


// ----------------------------------------------------
// Socket.IO Signaling Handlers
// ----------------------------------------------------

// ------------------------------------
// A. EXISTING USERS: Naya user unhe call karega (Sends Offer)
// ------------------------------------
socket.on('existing-participants', async (participants) => {
    console.log('Existing users found:', participants);
    
    // Naya user har maujood user ke liye Peer Connection banayega aur OFFER bhejega
    participants.forEach(async (participant) => {
        const targetSocketId = participant.socketId;

        // 1. Create Peer Connection
        const peer = createPeerConnection(targetSocketId);

        try {
            // 2. Create the Offer (The actual 'Call')
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

            // 3. Send the Offer via the server
            socket.emit('call-user', { 
                offer: offer, 
                toSocketId: targetSocketId 
            });
            console.log(`📞 Sending call offer to: ${participant.name} (${targetSocketId})`);
        } catch (error) {
            console.error("Error creating or sending offer:", error);
        }
    });
});


// ------------------------------------
// B. NEW USER CONNECTED: Existing users naye user ke call ke liye taiyar honge
// ------------------------------------
socket.on('user-connected', ({ name, email, socketId }) => {
    console.log(`👤 New user connected: ${name} (${socketId}). Preparing to receive call.`);
    
    // Existing user naye user ke liye Peer Connection banayega.
    // Jab naya user Offer bhejega, to 'incoming-call' event fire hoga.
    createPeerConnection(socketId, true);
});


// ------------------------------------
// C. INCOMING CALL: Pehle se maujood user naye user ki call uthayega (Receives Offer, Sends Answer)
// ------------------------------------
socket.on('incoming-call', async ({ offer, from, fromName }) => {
    console.log(`Incoming call from: ${fromName} (${from})`);
    
    // Peer connection 'user-connected' event mein ban chuka hoga.
    let peer = peers[from]; 
    
    // Agar kisi kaaran se peer nahi bana, toh yahaan dobara banao (fallback)
    if (!peer) {
         peer = createPeerConnection(from);
    }

    try {
        // 1. Set the received Offer as remote description
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        
        // 2. Create the Answer
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        // 3. Send the Answer back via the server
        socket.emit('make-answer', { 
            answer: answer, 
            toSocketId: from 
        });
        console.log(`🎙️ Sending answer back to ${fromName}.`);
    } catch (error) {
         console.error("Error handling incoming call:", error);
    }
});


// ------------------------------------
// D. ANSWER MADE: Naye user ko call ka jawab mila (Receives Answer)
// ------------------------------------
socket.on('answer-made', async ({ answer, from }) => {
    const peer = peers[from];
    if (peer) {
        console.log(`Answer received from ${from}. Setting remote description.`);
        try {
            // Set the received Answer as remote description
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
             console.error("Error setting answer as remote description:", error);
        }
    }
});


// ------------------------------------
// E. ICE CANDIDATE: Network information exchange
// ------------------------------------
socket.on('ice-candidate', async ({ candidate, from }) => {
    const peer = peers[from];
    if (peer && candidate) {
        try {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
            // console.log(`ICE candidate from ${from} added.`);
        } catch (e) {
            console.error('Error adding received ICE candidate:', e);
        }
    }
});

// ------------------------------------
// F. USER DISCONNECTED
// ------------------------------------
socket.on('user-disconnected', ({ socketId }) => {
    if (peers[socketId]) {
        peers[socketId].close(); // Close the peer connection
        delete peers[socketId];
        // Remove the video element from the DOM
        const videoElement = document.getElementById(`video-${socketId}`);
        if (videoElement) {
            videoElement.remove();
        }
        console.log(`User ${socketId} disconnected. Video removed.`);
    }
});


// ------------------------------------
// !!! IMPORTANT: Call startMedia function to start the video call !!!
// This is an example of how you would call it. 
// You must integrate this call logic into your HTML/Frontend forms.
// ------------------------------------
/*
document.addEventListener('DOMContentLoaded', () => {
    // These values MUST be fetched from user input forms or URL parameters.
    const meetingId = 'YOUR_DYNAMIC_MEETING_ID'; // e.g., from URL: /meeting/1234
    const userName = 'User Name'; 
    const userEmail = 'user@example.com'; 
    
    if (meetingId && userName && userEmail) {
        startMedia(meetingId, userName, userEmail);
    } else {
        console.error("Please ensure meeting details are provided before starting media.");
    }
});
*/