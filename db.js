// db.js
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
if (!uri) {
    throw new Error('MONGO_URI must be defined in your environment (.env)');
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
    if (db) return db;
    await client.connect();
    db = client.db(process.env.MONGO_DB_NAME || 'studyBot');
    console.log('✅ Connected to MongoDB');
    return db;
}

function getCollection(name) {
    if (!db) {
        throw new Error('MongoDB not connected. Call connectDB() before using getCollection().');
    }
    return db.collection(name);
}

module.exports = { connectDB, getCollection }; 