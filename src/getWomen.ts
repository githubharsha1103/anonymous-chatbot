/**
 * Script to get all women with all available fields from the database
 */
import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://rharsha1205_db_user:realme6123@cluster0.u7lyanp.mongodb.net/telugu_anomybot";
const DB_NAME = process.env.DB_NAME || "telugu_anomybot";

async function getWomenWithAllFields() {
  console.log("Connecting to MongoDB...");
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✓ Connected to MongoDB");
    
    const db = client.db(DB_NAME);
    const usersCollection = db.collection("users");
    
    // Query for all users with gender "Female" (case-insensitive)
    const women = await usersCollection.find({
      gender: { $regex: /^female$/i }
    }).toArray();
    
    console.log(`\n📊 Found ${women.length} women in the database:\n`);
    
    if (women.length === 0) {
      console.log("No women found in the database.");
    } else {
      women.forEach((user, index) => {
        console.log(`--- User ${index + 1} ---`);
        console.log("All fields:", JSON.stringify(user, null, 2));
        console.log("");
      });
    }
    
    return women;
    
  } catch (error) {
    console.error("✗ Error querying database:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nConnection closed.");
  }
}

getWomenWithAllFields()
  .then((women) => {
    console.log(`\n✅ Total women retrieved: ${women.length}`);
  })
  .catch((error) => {
    console.error("Failed to get women usernames:", error);
    process.exit(1);
  });
