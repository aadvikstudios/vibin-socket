const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const AWS = require("aws-sdk");
const cors = require("cors");

// Initialize Express
const app = express();

// Configure Middleware
app.use(
  cors({
    origin: "*", // Allow all origins (update in production)
    methods: ["GET", "POST"],
  })
);
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

    // Validate message contains required keys
    if (!message.matchId || !message.createdAt) {
      console.error("❌ Missing matchId or createdAt in message:", message);
      return;
    }

    // Ensure createdAt is a valid timestamp
    const createdAtTimestamp = message.createdAt || new Date().toISOString();

    // Define parameters for checking existing message
    const getParams = {
      TableName: TABLE_NAME,
      Key: {
        matchId: message.matchId,
        createdAt: createdAtTimestamp,
      },
    };

    console.log("🔍 Checking existing message:", getParams);

    // Check if the message already exists
    const existingMessage = await dynamoDB.get(getParams).promise();
    if (existingMessage.Item) {
      console.log("⚠️ Duplicate message detected:", message.messageId);
      return; // Skip saving duplicate message
    }

    // Define parameters for saving the message
    const putParams = {
      TableName: TABLE_NAME,
      Item: {
        matchId: message.matchId, // Partition key
        createdAt: createdAtTimestamp, // Sort key
        messageId: message.messageId, // Keeping for reference
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        isUnread: true,
        liked: false,
      },
    };

    console.log("📌 Saving message:", putParams);

    // Save the message to DynamoDB
    await dynamoDB.put(putParams).promise();
    console.log("✅ Message saved to DynamoDB:", message);
  } catch (error) {
    console.error("❌ Error saving message to DynamoDB:", error);
  }
};

// Create HTTP and WebSocket servers
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  },
});

// WebSocket logic
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Handle joining a room
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
    const { matchId, createdAt } = message;
    if (!matchId || !createdAt) {
      console.error("❌ Invalid matchId or createdAt in message");
      return;
    }

    console.log(
      `📩 New message in room ${matchId}:`,
      message.content || "Image Uploaded"
    );

    // Save the message to DynamoDB
    await saveMessageToDynamoDB(message);

    // Broadcast the message to the room
    io.to(matchId).emit("newMessage", message);
  });

  // Handle client disconnection
  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

// API Routes
app.get("/", (req, res) => {
  res.status(200).send("Welcome to the Vibin SOCKET");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
