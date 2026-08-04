import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const walletAddress = req.headers.get('x-wallet-address');

    if (!id || !walletAddress) return NextResponse.json({ error: 'Missing ID or wallet address' }, { status: 400 });

    const db = await getDb();

    // Verify ownership. An app carries a client_secret, so it is owner-only.
    const app = await db.collection('merchant_apps').findOne({ 
        _id: new ObjectId(id),
        $or: [
            { user_id: walletAddress }
        ]
    });

    if (!app) {
        return NextResponse.json({ error: 'App not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ app });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const walletAddress = req.headers.get('x-wallet-address');
    const body = await req.json();

    if (!id || !walletAddress) return NextResponse.json({ error: 'Missing ID or wallet address' }, { status: 400 });

    const db = await getDb();

    // Update, owner-only.
    const result = await db.collection('merchant_apps').findOneAndUpdate(
        { 
            _id: new ObjectId(id),
            $or: [
                { user_id: walletAddress }
            ]
        },
        { $set: { ...body, updated_at: new Date() } },
        { returnDocument: 'after' }
    );

    if (!result) {
        return NextResponse.json({ error: 'App not found or update failed' }, { status: 404 });
    }

    return NextResponse.json({ app: result });
}
