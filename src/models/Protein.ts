import mongoose, { Schema, Document } from 'mongoose';

export interface IProtein extends Document {
    name: string;
    price: number;
    isAvailable: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ProteinSchema: Schema = new Schema({
    name: { type: String, required: true, unique: true },
    price: { type: Number, required: true },
    isAvailable: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model<IProtein>('Protein', ProteinSchema);
