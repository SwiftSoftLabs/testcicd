import { NextResponse } from 'next/server';

import {
    findConversationLinkByExternalChannel,
    findInstallationBySlackTeamId,
} from '@/lib/plugins/chat/repository';
import { verifySlackSignature } from '@/lib/plugins/chat/slack';
import { ingestSlackMessage } from '@/lib/plugins/chat/ingest';

export const runtime = 'nodejs';

type SlackWebhookPayload = {
    type?: string;
    challenge?: string;
    team_id?: string;
    event?: {
        type?: string;
        channel?: string;
        user?: string;
        text?: string;
        ts?: string;
        bot_id?: string;
        subtype?: string;
        thread_ts?: string;
    };
};

export async function POST(request: Request) {
    const rawBody = await request.text();
    const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
    const signature = request.headers.get('x-slack-signature') ?? '';

    let payload: SlackWebhookPayload;
    try {
        payload = JSON.parse(rawBody) as SlackWebhookPayload;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Slack Event Subscriptions setup: echo challenge before auth on other events.
    // Signing secret must match SLACK_SIGNING_SECRET when configured.
    if (payload.type === 'url_verification' && payload.challenge) {
        const secret = process.env.SLACK_SIGNING_SECRET?.trim();
        if (secret && !verifySlackSignature(rawBody, timestamp, signature)) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
        return NextResponse.json({ challenge: payload.challenge });
    }

    if (!verifySlackSignature(rawBody, timestamp, signature)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    if (payload.type !== 'event_callback' || !payload.event) {
        return NextResponse.json({ ok: true });
    }

    const event = payload.event;
    if (event.type !== 'message' || event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
        return NextResponse.json({ ok: true });
    }
    if (!event.channel || !event.ts || !event.text) {
        return NextResponse.json({ ok: true });
    }

    const teamId = payload.team_id;
    if (!teamId) return NextResponse.json({ ok: true });

    const installation = await findInstallationBySlackTeamId(teamId);
    if (!installation) return NextResponse.json({ ok: true });

    const link = await findConversationLinkByExternalChannel(installation.id, event.channel);
    if (!link) return NextResponse.json({ ok: true });

    try {
        await ingestSlackMessage(installation, link, {
            ts: event.ts,
            user: event.user,
            text: event.text,
            bot_id: event.bot_id,
            thread_ts:
                event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : undefined,
        });
    } catch (err) {
        console.error('[slack webhook]', err);
    }

    return NextResponse.json({ ok: true });
}
