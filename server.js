const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const AWS = require("aws-sdk");
const cors = require("cors");

// Initialize Express
const app = express();

// Configure Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json()); // Parse JSON bodies

// Initialize AWS SDK
AWS.config.update({
  region: "ap-south-1", // Update to your AWS region
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = "Messages"; // DynamoDB table name

// Function to save message to DynamoDB
const saveMessageToDynamoDB = async (message) => {
  try {
    console.log("🟢 Message received:", message);

    if (!message.matchId || !message.createdAt) {
      console.error("❌ Missing matchId or createdAt in message:", message);
      return;
    }

    const createdAtTimestamp = message.createdAt || new Date().toISOString();

    const getParams = {
      TableName: TABLE_NAME,
      Key: { matchId: message.matchId, createdAt: createdAtTimestamp },
    };

    const existingMessage = await dynamoDB.get(getParams).promise();
    if (existingMessage.Item) {
      console.log("⚠️ Duplicate message detected:", message.messageId);
      return;
    }

    const putParams = {
      TableName: TABLE_NAME,
      Item: {
        matchId: message.matchId,
        createdAt: createdAtTimestamp,
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        isUnread: true,
        liked: false,
      },
    };

    await dynamoDB.put(putParams).promise();
    console.log("✅ Message saved to DynamoDB:", message);
  } catch (error) {
    console.error("❌ Error saving message to DynamoDB:", error);
  }
};

// Create HTTP and WebSocket servers
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// WebSocket logic
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Join a chat room
  socket.on("join", ({ matchId }) => {
    if (matchId) {
      socket.join(matchId);
      console.log(`👥 User ${socket.id} joined room: ${matchId}`);
    } else {
      console.error("❌ Invalid matchId provided");
    }
  });

  // Handle sending messages
  socket.on("sendMessage", async (message) => {
    if (!message.matchId || !message.createdAt) {
      console.error("❌ Invalid matchId or createdAt in message");
      return;
    }

    console.log(
      `📩 New message in room ${message.matchId}:`,
      message.content || "Image Uploaded"
    );

    await saveMessageToDynamoDB(message);
    io.to(message.matchId).emit("newMessage", message);
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

// API Routes
app.get("/", (req, res) => res.status(200).send("Welcome to Vibin SOCKET"));
app.get("/health", (req, res) => res.status(200).json({ status: "healthy" }));

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
