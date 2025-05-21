// const { MongoClient } = require('mongodb');
import {MongoClient} from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const dbConfig = process.env.DATABASE_URL;
const databaseName = process.env.DATABASE_NAME;

let mongoClient = null;

async function connectToMongoDB() {
    if (!mongoClient) {
        try {
            const client = new MongoClient(dbConfig, {
                maxPoolSize: 20,
                minPoolSize: 5,
                maxIdleTimeMS: 30000,
                waitQueueTimeoutMS: 10000,
                serverSelectionTimeoutMS: 5000, // Timeout if MongoDB is unavailable
                connectTimeoutMS: 10000 // Time allowed to establish a connection
            });

            await client.connect();
            mongoClient = client.db(databaseName);
            console.log('MongoDB Connected Successfully');
        } catch (err) {
            console.error('Error connecting to MongoDB', err);
            process.exit(1);
        }
    }
    return mongoClient;
}

export default connectToMongoDB;
// module.exports = connectToMongoDB;
