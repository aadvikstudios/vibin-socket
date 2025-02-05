const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const AWS = require("aws-sdk");

// Initialize Express & Socket.IO
const app = express();
const httpServer = createServer(app);

// Configure CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Configure AWS SDK (Set the Region)
AWS.config.update({
  region: "ap-south-1", // Change to your AWS region
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Use Environment Variables
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = "Messages"; // Change to your DynamoDB table name

// Function to save message to DynamoDB
const saveMessageToDynamoDB = async (message) => {
  const params = {
    TableName: TABLE_NAME,
    Item: {
      matchId: message.matchId,
      messageId: message.messageId,
      senderId: message.senderId,
      content: message.content,
      createdAt: new Date().toISOString(),
      isUnread: true,
      liked: false,
    },
  };

  try {
    await dynamoDB.put(params).promise();
    console.log("✅ Message saved to DynamoDB:", message);
  } catch (error) {
    console.error("❌ Failed to save message to DynamoDB:", error);
  }
};

// Add Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.get("/", (req, res) => {
  res.status(200).send("Welcome to the Vibin Socket!");
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
  socket.on("sendMessage", async (message) => {
    const { matchId, content, senderId, messageId } = message;
    if (matchId) {
      console.log(`📩 New message in room ${matchId}:`, content);

      // Save message to DynamoDB
      await saveMessageToDynamoDB(message);

      // Broadcast to the room
      io.to(matchId).emit("newMessage", message);
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