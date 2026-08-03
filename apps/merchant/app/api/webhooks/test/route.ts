import { NextRequest, NextResponse } from 'next/server';
import { sendWebhook } from '@/lib/webhookSender';

export async function POST(req: NextRequest) {
    const { webhookId } = await req.json();

    if (!webhookId) return NextResponse.json({ error: 'Missing webhook ID' }, { status: 400 });

    const result = await sendWebhook(webhookId, 'test.event', {
        message: 'This is a test webhook from Polaris Console',
        id: `test_${Math.random().toString(36).substring(7)}`,
        timestamp: new Date().toISOString()
    });

    return NextResponse.json(result);
}
