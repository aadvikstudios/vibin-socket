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

// Handle "sendMessage" event
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

  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, Reason: ${reason}`);
  });
});
