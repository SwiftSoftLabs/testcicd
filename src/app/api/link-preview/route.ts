import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

const BLOCKED_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
]);

function isBlockedUrl(raw: string): boolean {
    try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) return true;
        const host = parsed.hostname.toLowerCase();
        if (BLOCKED_HOSTS.has(host)) return true;
        if (host.endsWith('.local')) return true;
        if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(host)) return true;
        return false;
    } catch {
        return true;
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireSessionUser(request);

        const { url } = await request.json();

        if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
            return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
        }

        if (isBlockedUrl(url)) {
            return NextResponse.json({ error: 'URL not allowed' }, { status: 400 });
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; OneWorkBot/1.0; +https://onework.app)',
            },
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 400 });
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const getMetaTag = (name: string) => {
            return (
                $(`meta[property="${name}"]`).attr('content') ||
                $(`meta[name="${name}"]`).attr('content') ||
                $(`meta[property="og:${name}"]`).attr('content') ||
                $(`meta[name="twitter:${name}"]`).attr('content')
            );
        };

        const title = getMetaTag('title') || $('title').text();
        const description = getMetaTag('description');
        const image = getMetaTag('image');

        return NextResponse.json({
            title,
            description,
            image,
            url,
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
