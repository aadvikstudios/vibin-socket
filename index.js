const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const httpServer = createServer(app);

// Configure CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins (adjust as needed for production)
    methods: ["GET", "POST"],
  },
});

// Handle connection
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Handle 'join' event
  socket.on("join", ({ matchId }) => {
    if (matchId) {
      socket.join(matchId);
      console.log(`👥 User ${socket.id} joined room: ${matchId}`);
    } else {
      console.error("❌ Invalid matchId provided");
    }
  });

  // Handle 'sendMessage' event
  socket.on("sendMessage", (message) => {
    const { matchId, content } = message;
    if (matchId) {
      console.log(`📩 New message in room ${matchId}:`, content);
      io.to(matchId).emit("newMessage", message); // Broadcast to the room
    } else {
      console.error("❌ Invalid matchId in message");
    }
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});