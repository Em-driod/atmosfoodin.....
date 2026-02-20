import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
    name: string;
    description: string;
    price: number;
    category: 'Grains' | 'Drinks';
    image: string;
    rating: number;
    calories: number;
    tags: string[];
    isAvailable: boolean;
    proteins: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const ProductSchema: Schema = new Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, enum: ['Grains', 'Drinks'], required: true },
    image: { type: String, required: true },
    rating: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    isAvailable: { type: Boolean, default: true },
    proteins: [{ type: Schema.Types.ObjectId, ref: 'Protein' }],
}, { timestamps: true });

export default mongoose.model<IProduct>('Product', ProductSchema);
