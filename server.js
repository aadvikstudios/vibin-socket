const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const AWS = require("aws-sdk");
const cors = require("cors");
require("dotenv").config(); // Load environment variables

// Initialize Express
const app = express();

// Configure Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// Initialize AWS SDK
AWS.config.update({
  region: "ap-south-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = "Message"; // DynamoDB table for private chat
const GROUP_TABLE_NAME = "GroupMessages"; // DynamoDB table for group chat

// Create HTTP and WebSocket servers
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/** ✅ Function to Save Messages in DynamoDB */
const saveMessageToDynamoDB = async (tableName, message) => {
  try {
    console.log("🟢 Message received:", message);

    if (!message.matchId && !message.groupId) {
      console.error("❌ Missing matchId/groupId in message:", message);
      return;
    }

    const createdAtTimestamp = message.createdAt || new Date().toISOString();

    const putParams = {
      TableName: tableName,
      Item: {
        matchId: message.matchId || null,
        groupId: message.groupId || null,
        createdAt: createdAtTimestamp,
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content || null,
        imageUrl: message.imageUrl || null,
        replyTo: message.replyTo || null,
        isUnread: "true",
        liked: false,
      },
      ConditionExpression: "attribute_not_exists(messageId)", // Prevent duplicates
    };

    await dynamoDB.put(putParams).promise();
    console.log(`✅ Message saved to DynamoDB [${tableName}]:`, message);
  } catch (error) {
    console.error(`❌ Error saving message to DynamoDB [${tableName}]:`, error);
  }
};

/** ✅ WebSocket logic */
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // 🔹 Join Private Chat Room
  socket.on("join", ({ matchId }) => {
    if (matchId) {
      socket.join(matchId);
      console.log(`👥 User ${socket.id} joined private chat: ${matchId}`);
    } else {
      console.error("❌ Invalid matchId provided");
    }
  });

  // 🔹 Join Group Chat Room
  socket.on("joinGroup", ({ groupId }) => {
    if (groupId) {
      socket.join(groupId);
      console.log(`👥 User ${socket.id} joined group chat: ${groupId}`);
    } else {
      console.error("❌ Invalid groupId provided");
    }
  });

  /** ✅ Handle Sending Private Messages */
  socket.on("sendMessage", async (message) => {
    if (!message.matchId || !message.createdAt) {
      console.error("❌ Invalid matchId or createdAt in message");
      return;
    }

    console.log(
      `📩 New private message in ${message.matchId}:`,
      message.content
    );
    await saveMessageToDynamoDB(TABLE_NAME, message);

    // Emit the message to the room
    io.to(message.matchId).emit("newMessage", message);
  });

  /** ✅ Handle Sending Group Messages */
  socket.on("sendGroupMessage", async (message) => {
    if (!message.groupId || !message.createdAt) {
      console.error("❌ Invalid groupId or createdAt in message");
      return;
    }

    console.log(
      `📩 New group message received in ${message.groupId}:`,
      message.content || "[Image]"
    );

    try {
      // ✅ Save message to DB first (if not already exists)
      const getParams = {
        TableName: GROUP_TABLE_NAME,
        Key: {
          groupId: message.groupId,
          messageId: message.messageId, // Ensure uniqueness
        },
      };

      const existingMessage = await dynamoDB.get(getParams).promise();
      if (existingMessage.Item) {
        console.warn(
          `⚠️ Duplicate message detected. Skipping: ${message.messageId}`
        );
        return;
      }

      // ✅ Store message in DB
      await saveMessageToDynamoDB(GROUP_TABLE_NAME, message);

      // ✅ Emit message to **ALL** users in the group including sender
      io.to(message.groupId).emit("newGroupMessage", message);
    } catch (error) {
      console.warn(
        `⚠️ Message ${message.messageId} might already exist. Skipping duplicate insert.`
      );
    }
  });

  /** ✅ Handle Liking a Private Message */
  socket.on("likeMessage", async ({ matchId, createdAt, liked }) => {
    try {
      if (!matchId || !createdAt) {
        console.error("❌ Invalid likeMessage event parameters");
        return;
      }

      console.log(
        `❤️ Private Message at ${createdAt} in ${matchId} liked: ${liked}`
      );

      const updateParams = {
        TableName: TABLE_NAME,
        Key: { matchId, createdAt },
        UpdateExpression: "set liked = :liked",
        ExpressionAttributeValues: { ":liked": liked },
      };

      await dynamoDB.update(updateParams).promise();
      io.to(matchId).emit("messageLiked", { matchId, createdAt, liked });
    } catch (error) {
      console.error("❌ Error liking private message:", error);
    }
  });

  /** ✅ Handle Liking a Group Message */
  socket.on("likeGroupMessage", async ({ groupId, messageId, liked }) => {
    try {
      if (!groupId || !messageId) {
        console.error("❌ Invalid likeGroupMessage event parameters");
        return;
      }

      console.log(
        `❤️ Group Message ${messageId} in ${groupId} liked: ${liked}`
      );

      const updateParams = {
        TableName: GROUP_TABLE_NAME,
        Key: { groupId, messageId },
        UpdateExpression: "set liked = :liked",
        ExpressionAttributeValues: { ":liked": liked },
      };

      await dynamoDB.update(updateParams).promise();
      io.to(groupId).emit("groupMessageLiked", { groupId, messageId, liked });
    } catch (error) {
      console.error("❌ Error liking group message:", error);
    }
  });

  /** ✅ Handle Marking Private Messages as Read */
  socket.on("markAsRead", async ({ matchId, userHandle }) => {
    try {
      console.log(
        `👀 Marking private messages as read for ${matchId} by ${userHandle}`
      );
      io.to(matchId).emit("messagesRead", { matchId, readerId: userHandle });
    } catch (error) {
      console.error("❌ Error marking private messages as read:", error);
    }
  });

  /** ✅ Handle Marking Group Messages as Read */
  socket.on("markGroupMessagesAsRead", async ({ groupId, userHandle }) => {
    try {
      console.log(
        `👀 Marking group messages as read for ${groupId} by ${userHandle}`
      );
      io.to(groupId).emit("groupMessagesRead", {
        groupId,
        readerId: userHandle,
      });
    } catch (error) {
      console.error("❌ Error marking group messages as read:", error);
    }
  });

  /** ✅ Handle Disconnection */
  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});

/** ✅ API Routes */
app.get("/", (req, res) => res.status(200).send("Welcome to Vibin SOCKET"));
app.get("/health", (req, res) => res.status(200).json({ status: "healthy" }));

/** ✅ Start the Server */
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
