import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import {
  claimWebhookDelivery,
  notifyWorkspaceVcEvent,
  resolvePlatformRepoContext,
} from "@/lib/integrations/git/vc-notifications";
import { triggerDeployOnPush } from "@/lib/integrations/git/vercel-cicd";

function verifyGiteaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.trim().toLowerCase();
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function repoFullNameFromPayload(payload: Record<string, unknown>): string | null {
  const repository = payload.repository as
    | { full_name?: string; owner?: { login?: string }; name?: string }
    | undefined;
  if (repository?.full_name) return repository.full_name;
  if (repository?.owner?.login && repository?.name) {
    return `${repository.owner.login}/${repository.name}`;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.ONEWORK_VC_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get("X-Gitea-Signature") ||
    request.headers.get("x-gitea-signature");
  if (!verifyGiteaSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const eventType =
    request.headers.get("X-Gitea-Event") ||
    request.headers.get("x-gitea-event") ||
    "unknown";
  const deliveryId =
    request.headers.get("X-Gitea-Delivery") ||
    request.headers.get("x-gitea-delivery") ||
    createHmac("sha256", secret).update(rawBody).digest("hex");

  const claimed = await claimWebhookDelivery(deliveryId, eventType);
  if (!claimed) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = repoFullNameFromPayload(payload);
  if (!fullName) {
    return NextResponse.json({ ok: true, skipped: "no_repo" });
  }

  const ctx = await resolvePlatformRepoContext(fullName);
  if (!ctx) {
    return NextResponse.json({ ok: true, skipped: "unknown_repo" });
  }

  const action = typeof payload.action === "string" ? payload.action : "";

  try {
    if (eventType === "push") {
      const after =
        typeof payload.after === "string" ? payload.after.slice(0, 12) : "";
      const ref = typeof payload.ref === "string" ? payload.ref : "refs/heads/?";
      const pusher = (payload.pusher as { login?: string } | undefined)?.login;
      await notifyWorkspaceVcEvent({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        type: "vc_push",
        title: `Push to ${fullName}`,
        content: `${pusher || "Someone"} pushed to ${ref.replace("refs/heads/", "")}${after ? ` (${after})` : ""}`,
        extra: `push:${payload.after || deliveryId}`,
      });
      triggerDeployOnPush(payload).catch((err) => {
        console.error("[onework-vc webhook] vercel deploy trigger failed", err);
      });
    } else if (eventType === "pull_request") {
      const pr = payload.pull_request as
        | { number?: number; title?: string }
        | undefined;
      const number = pr?.number;
      if (number && (action === "opened" || action === "reopened")) {
        await notifyWorkspaceVcEvent({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          type: "vc_pr_opened",
          title: `PR opened: ${pr?.title || `#${number}`}`,
          content: `${fullName} #${number}`,
          extra: `pr=${number}:opened`,
        });
      } else if (number && action === "closed") {
        const merged = Boolean(
          (payload.pull_request as { merged?: boolean } | undefined)?.merged,
        );
        if (merged) {
          await notifyWorkspaceVcEvent({
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            type: "vc_pr_merged",
            title: `Merged ${fullName} #${number}`,
            content: pr?.title || `Pull request #${number} was merged.`,
            extra: `pr=${number}:merged`,
          });
        } else {
          await notifyWorkspaceVcEvent({
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            type: "vc_pr_closed",
            title: `PR closed: ${pr?.title || `#${number}`}`,
            content: `${fullName} #${number} was closed without merging.`,
            extra: `pr=${number}:closed`,
          });
        }
      } else if (number && action === "merged") {
        await notifyWorkspaceVcEvent({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          type: "vc_pr_merged",
          title: `Merged ${fullName} #${number}`,
          content: pr?.title || `Pull request #${number} was merged.`,
          extra: `pr=${number}:merged`,
        });
      }
    } else if (
      eventType === "issue_comment" ||
      eventType === "pull_request_comment"
    ) {
      const issue = payload.issue as
        | { number?: number; pull_request?: unknown }
        | undefined;
      const comment = payload.comment as { id?: number; body?: string } | undefined;
      if (issue?.pull_request && issue.number && action === "created") {
        await notifyWorkspaceVcEvent({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          type: "vc_pr_comment",
          title: `Comment on ${fullName} #${issue.number}`,
          content: (comment?.body || "").slice(0, 240),
          extra: `pr=${issue.number}:comment:${comment?.id || deliveryId}`,
        });
      }
    } else if (eventType === "release" && action === "published") {
      const release = payload.release as
        | { id?: number; name?: string; tag_name?: string }
        | undefined;
      await notifyWorkspaceVcEvent({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        type: "vc_release",
        title: `Release ${release?.name || release?.tag_name || ""}`,
        content: `${fullName} · ${release?.tag_name || ""}`,
        extra: `release:${release?.id || deliveryId}`,
      });
    } else if (eventType === "status") {
      const state = typeof payload.state === "string" ? payload.state : "";
      if (state === "failure" || state === "error" || state === "success") {
        const context =
          typeof payload.context === "string" ? payload.context : "status";
        const sha =
          typeof payload.sha === "string" ? payload.sha.slice(0, 12) : "";
        await notifyWorkspaceVcEvent({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          type: "vc_check",
          title: `Check ${state}: ${context}`,
          content: `${fullName}${sha ? ` @ ${sha}` : ""}`,
          extra: `check:${context}:${sha}:${state}`,
        });
      }
    }
  } catch (e) {
    console.error("[onework-vc webhook]", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
