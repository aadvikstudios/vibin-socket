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

    const putParams = {
      TableName: TABLE_NAME,
      Item: {
        matchId: message.matchId,
        createdAt: createdAtTimestamp,
        messageId: message.messageId,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        status: "sent", // Initial status
      },
    };

    await dynamoDB.put(putParams).promise();
    io.to(message.matchId).emit("newMessage", message);
    console.log("✅ Message saved and sent: ", message.messageId);
  } catch (error) {
    console.error("❌ Error saving message:", error);
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

  socket.on("join", async ({ matchId, userId }) => {
    if (!matchId || !userId) return;

    console.log(`👤 User ${userId} joined chat ${matchId}`);
    socket.join(matchId);

    try {
      const scanParams = {
        TableName: TABLE_NAME,
        FilterExpression:
          "matchId = :matchId AND receiverId = :userId AND #status = :sent",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":matchId": matchId,
          ":userId": userId,
          ":sent": "sent",
        },
      };

      const { Items } = await dynamoDB.scan(scanParams).promise();

      if (Items.length > 0) {
        for (let msg of Items) {
          const updateParams = {
            TableName: TABLE_NAME,
            Key: { matchId, createdAt: msg.createdAt },
            UpdateExpression: "set #status = :delivered",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":delivered": "delivered" },
          };
          await dynamoDB.update(updateParams).promise();
        }
        io.to(matchId).emit("messageStatusUpdate", { status: "delivered" });
      }
    } catch (error) {
      console.error("❌ Error updating messages to delivered:", error);
    }
  });

  socket.on("messageRead", async ({ matchId, userId }) => {
    if (!matchId || !userId) return;
    console.log(`🔍 Marking messages as read for chat ${matchId}`);

    try {
      const scanParams = {
        TableName: TABLE_NAME,
        FilterExpression:
          "matchId = :matchId AND receiverId = :userId AND #status = :delivered",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":matchId": matchId,
          ":userId": userId,
          ":delivered": "delivered",
        },
      };

      const { Items } = await dynamoDB.scan(scanParams).promise();
      if (Items.length > 0) {
        console.log(`✅ Found ${Items.length} messages to update to "read"`);

        // Use `Promise.all()` for efficiency
        await Promise.all(
          Items.map(async (msg) => {
            const updateParams = {
              TableName: TABLE_NAME,
              Key: { matchId, createdAt: msg.createdAt },
              UpdateExpression: "set #status = :read",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":read": "read" },
            };
            return dynamoDB.update(updateParams).promise();
          })
        );

        io.to(matchId).emit("messageStatusUpdate", { status: "read" });
      }
    } catch (error) {
      console.error("❌ Error updating messages to read:", error);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
