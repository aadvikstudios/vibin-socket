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

// Create HTTP and WebSocket servers
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  },
});

// Function to save message to DynamoDB
const saveMessageToDynamoDB = async (message) => {
  try {
    // Define parameters for checking existing message
    const getParams = {
      TableName: TABLE_NAME,
      Key: {
        matchId: message.matchId,
        messageId: message.messageId,
      },
    };

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
        matchId: message.matchId,
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        createdAt: message.createdAt || new Date().toISOString(),
        isUnread: true,
        liked: false,
      },
    };

    // Save the message to DynamoDB
    await dynamoDB.put(putParams).promise();
    console.log("✅ Message saved to DynamoDB:", message);
  } catch (error) {
    console.error("❌ Error saving message to DynamoDB:", error.message);
  }
};

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
    const { matchId, messageId } = message;
    if (!matchId || !messageId) {
      console.error("❌ Invalid matchId or messageId in message");
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
  res.status(200).send("Welcome to the Vibin API!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});