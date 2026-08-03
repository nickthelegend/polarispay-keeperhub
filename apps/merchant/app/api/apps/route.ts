import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
    const walletAddress = req.headers.get('x-wallet-address');

    if (!walletAddress) {
        return NextResponse.json({ error: 'Missing wallet address header' }, { status: 400 });
    }

    const db = await getDb();

    // 1. Ensure "gucci-store" exists in the DB with the client ID/secret we set in the shopping app
    const gucciClientId = "prod_3b9921c551835a189d4ef0de";
    const gucciClientSecret = "sk_236fe312b2010fb190026af19d11ce6d5b21b2524c7b1fe9";
    
    let gucciApp: any = await db.collection('merchant_apps').findOne({ name: 'gucci-store' });
    if (!gucciApp) {
        gucciApp = {
            user_id: '0xGucciOwnerWallet',
            wallet_address: '0xGucciOwnerWallet',
            name: 'gucci-store',
            category: 'Luxury Fashion',
            client_id: gucciClientId,
            client_secret: gucciClientSecret,
            network: 'sepolia',
            status: 'active',
            created_at: new Date(),
            updated_at: new Date()
        };
        await db.collection('merchant_apps').insertOne(gucciApp);
    }

    // 2. Get User (auto-create if doesn't exist so dashboard loads successfully)
    const user = await db.collection('merchant_users').findOne({ wallet_address: walletAddress });
    if (!user) {
        await db.collection('merchant_users').insertOne({
            wallet_address: walletAddress,
            created_at: new Date(),
            updated_at: new Date()
        });
    }

    // 3. Get Apps (Return user's apps OR the gucci-store app)
    const apps = await db.collection('merchant_apps')
        .find({
            $or: [
                { user_id: walletAddress },
                { name: 'gucci-store' }
            ]
        })
        .sort({ created_at: -1 })
        .toArray();

    return NextResponse.json({ apps });
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-wallet-address',
        },
    });
}


export async function POST(req: NextRequest) {
    try {
        const { wallet_address, name, category } = await req.json();

        if (!wallet_address || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const db = await getDb();

        // 1. Get User (or fail)
        const user = await db.collection('merchant_users').findOne({ wallet_address });

        if (!user) {
            return NextResponse.json({ error: 'User not registered. Please refresh.' }, { status: 404 });
        }

        // 2. Check for duplicate app name per wallet
        const existingApp = await db.collection('merchant_apps').findOne({
            user_id: wallet_address,
            name
        });

        if (existingApp) {
            return NextResponse.json(
                { error: 'An app with this name already exists for your wallet' },
                { status: 409 }
            );
        }

        // 3. Create App with unique credentials (crypto.randomUUID for client_id, randomBytes for secret)
        const client_id = `prod_${crypto.randomUUID().replace(/-/g, '')}`;
        const client_secret = `sk_${crypto.randomBytes(24).toString('hex')}`;

        const newApp = {
            user_id: wallet_address,
            wallet_address,
            name,
            category: category || '',
            client_id,
            client_secret,
            network: 'sepolia',
            status: 'active',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('merchant_apps').insertOne(newApp);

        return NextResponse.json({ app: { ...newApp, _id: result.insertedId } });
    } catch (error: any) {
        console.error('Create App Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
