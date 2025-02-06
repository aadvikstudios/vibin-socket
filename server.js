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
  region: "ap-south-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = "Messages";

// Function to save message to DynamoDB
const saveMessageToDynamoDB = async (message) => {
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      matchId: message.matchId,
      messageId: message.messageId,
    },
  };

  try {
    const existingMessage = await dynamoDB.get(getParams).promise();

    if (existingMessage.Item) {
      console.log("⚠️ Duplicate message detected:", message.messageId);
      return; // Skip saving duplicate message
    }

    const putParams = {
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

    await dynamoDB.put(putParams).promise();
    console.log("✅ Message saved to DynamoDB:", message);
  } catch (error) {
    console.error("❌ Failed to save message to DynamoDB:", error);
  }
};

// Add Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Add Root Route
app.get("/", (req, res) => {
  res.status(200).send("Welcome to the Vibin API!");
});

// Handle connection
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  socket.on("join", ({ matchId }) => {
    if (matchId) {
      socket.join(matchId);
      console.log(`👥 User ${socket.id} joined room: ${matchId}`);
    } else {
      console.error("❌ Invalid matchId provided");
    }
  });

  socket.on("sendMessage", async (message) => {
    const { matchId, content, senderId, messageId } = message;
    if (matchId) {
      console.log(`📩 New message in room ${matchId}:`, content);
      await saveMessageToDynamoDB(message);
      io.to(matchId).emit("newMessage", message);
    } else {
      console.error("❌ Invalid matchId in message");
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});