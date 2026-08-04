import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const db = await getDb();
        const webhooks = await db.collection('webhooks').find({ app_id: id }).toArray();
        return NextResponse.json({ webhooks });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();
    const { url, events } = body;

    // Math.random() is not a CSPRNG; an HMAC secret drawn from it is guessable.
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;

    try {
        const db = await getDb();
        const result = await db.collection('webhooks').insertOne({
            app_id: id,
            url,
            events: events || ['payment.settled'],
            secret,
            is_active: true,
            created_at: new Date(),
        });

        const webhook = await db.collection('webhooks').findOne({ _id: result.insertedId });
        return NextResponse.json({ webhook });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
