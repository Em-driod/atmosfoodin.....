import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI as string);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error: any) {
        if (error.message.includes('Authentication failed')) {
            console.error('❌ MongoDB Auth Error: The username or password in your .env is incorrect.');
        } else {
            console.error(`❌ MongoDB Error: ${error.message}`);
        }
        process.exit(1);
    }
};

export default connectDB;
