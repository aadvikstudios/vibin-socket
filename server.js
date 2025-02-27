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
const TABLE_NAME = "Message"; // DynamoDB table name

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
        createdAt: message.createdAt,
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        isUnread: "true",
        liked: false,
      },
      ConditionExpression: "attribute_not_exists(messageId)", // Prevent duplicates
    };
    await dynamoDB.put(putParams).promise();

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

    console.log(`📩 New message in room ${message.matchId}:`, message.content);

    const putParams = {
      TableName: TABLE_NAME,
      Item: {
        matchId: message.matchId,
        createdAt: message.createdAt,
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        replyTo: message.replyTo || null, // ✅ Store reply data
      },
    };

    await dynamoDB.put(putParams).promise();
    io.to(message.matchId).emit("newMessage", message);
  });

  // Handle liking a message
  socket.on("likeMessage", async ({ matchId, createdAt, liked }) => {
    try {
      if (!matchId || !createdAt) {
        console.error("❌ Invalid likeMessage event parameters");
        return;
      }

      console.log(
        `❤️ Message at ${createdAt} in match ${matchId} liked: ${liked}`
      );

      // Update message like status in DynamoDB
      const updateParams = {
        TableName: TABLE_NAME,
        Key: { matchId, createdAt }, // ✅ Correct primary key
        UpdateExpression: "set liked = :liked",
        ExpressionAttributeValues: { ":liked": liked },
      };

      await dynamoDB.update(updateParams).promise();

      // Broadcast the like event to all clients in the match room
      io.to(matchId).emit("messageLiked", { matchId, createdAt, liked });

      console.log(
        `✅ Message at ${createdAt} updated withandleSendMessage h liked=${liked}`
      );
    } catch (error) {
      console.error("❌ Error liking message:", error);
    }
  });

  // Handle marking messages as read
  socket.on("markAsRead", async ({ matchId, userHandle }) => {
    try {
      console.log(
        `👀 Marking messages as read for matchId: ${matchId} by ${userHandle}`
      );

      // Broadcast the read event
      io.to(matchId).emit("messagesRead", { matchId, readerId: userHandle });
    } catch (error) {
      console.error("❌ Error marking messages as read:", error);
    }
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
