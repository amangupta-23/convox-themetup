// ===================================
// public/client.js (FINAL CODE)
// ===================================

// ** MANDATORY FIX: Render Backend URL for Socket.IO **
const BACKEND_SOCKET_URL = 'https://convox-themetup.onrender.com'; 
const socket = io(BACKEND_SOCKET_URL); 

// Browser compatibility check ke liye
const RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;

const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; 
myVideo.id = 'my-video'; 
const peers = {}; 

// ----------------------------------------------------
// 1. STUN/TURN Server Configuration 
// ----------------------------------------------------
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
    ]
};

let localStream;

// A function to set up the media stream and join the room
async function startMedia(meetingId, name, email) {
    if (!meetingId || !name || !email) {
        console.error("Meeting details are missing.");
        // alert("Please provide Meeting ID, Name, and Email."); // alert हटा सकते हैं, क्योंकि meeting.html पेज पर आने से पहले ही चेक हो जाएगा
        return;
    }

    try {
        // 1. Get local media (camera and microphone)
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addVideoStream(myVideo, localStream);

        // 2. Inform server that this user has joined and is ready
        socket.emit('join-room', { meetingId, name, email });

    } catch (err) {
        console.error('❌ Error accessing media (Ensure HTTPS):', err);
        alert('Could not get access to your camera and microphone! Please check permissions and ensure the site is running on HTTPS.');
    }
}

// Function to display the video stream in the HTML
function addVideoStream(videoElement, stream) {
    videoElement.srcObject = stream;
    videoElement.addEventListener('loadedmetadata', () => {
        videoElement.play();
    });
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
    peer.ontrack = (event) => {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `video-${targetSocketId}`;
        remoteVideo.classList.add('remote-video');
        addVideoStream(remoteVideo, event.streams[0]);
        console.log(`✅ Remote stream from ${targetSocketId} received.`);
    };

    // --- Event 2: ICE Candidate Exchange ---
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                toSocketId: targetSocketId
            });
        }
    };
    
    peer.onconnectionstatechange = (event) => {
        console.log(`Connection state with ${targetSocketId}: ${peer.connectionState}`);
    };

    return peer;
}


// ----------------------------------------------------
// Socket.IO Signaling Handlers
// ----------------------------------------------------

socket.on('existing-participants', async (participants) => {
    console.log('Existing users found:', participants);
    
    participants.forEach(async (participant) => {
        const targetSocketId = participant.socketId;
        const peer = createPeerConnection(targetSocketId);

        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);

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


socket.on('user-connected', ({ name, email, socketId }) => {
    console.log(`👤 New user connected: ${name} (${socketId}). Preparing to receive call.`);
    
    createPeerConnection(socketId, true);
});


socket.on('incoming-call', async ({ offer, from, fromName }) => {
    console.log(`Incoming call from: ${fromName} (${from})`);
    
    let peer = peers[from]; 
    if (!peer) {
        // Fallback: Agar user-connected event miss ho gaya ho
        peer = createPeerConnection(from);
    }

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit('make-answer', { 
            answer: answer, 
            toSocketId: from 
        });
        console.log(`🎙️ Sending answer back to ${fromName}.`);
    } catch (error) {
        console.error("Error handling incoming call:", error);
    }
});


socket.on('answer-made', async ({ answer, from }) => {
    const peer = peers[from];
    if (peer) {
        console.log(`Answer received from ${from}. Setting remote description.`);
        try {
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error("Error setting answer as remote description:", error);
        }
    }
});


socket.on('ice-candidate', async ({ candidate, from }) => {
    const peer = peers[from];
    if (peer && candidate) {
        try {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ICE candidate:', e);
        }
    }
});

socket.on('user-disconnected', ({ socketId }) => {
    if (peers[socketId]) {
        peers[socketId].close(); 
        delete peers[socketId];
        const videoElement = document.getElementById(`video-${socketId}`);
        if (videoElement) {
            videoElement.remove();
        }
        console.log(`User ${socketId} disconnected. Video removed.`);
    }
});

// `startMedia` function को `meeting.html` से कॉल किया जाएगा।
