import { z } from "zod";

export const gitProviderSchema = z.enum(["github", "gitlab", "onework"]);

export const workspaceIdQuerySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
});

export const connectPatBodySchema = z.object({
  workspaceId: z.string().uuid(),
  token: z.string().min(1, "Token is required").max(8192),
});

export const oauthStartQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid("Invalid project ID"),
  returnTo: z.string().max(2048).optional().default("/settings/git-ssh"),
});

export const linkedReposListQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  provider: gitProviderSchema,
});

const linkedRepoItemSchema = z.object({
  id: z.string().min(1).max(128),
  owner: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  fullName: z.string().min(1).max(512),
  private: z.boolean(),
  defaultBranch: z.string().min(1).max(256),
  htmlUrl: z.string().min(1).max(2048),
  cloneUrl: z.string().min(1).max(2048),
  sshUrl: z.string().min(1).max(2048),
  description: z.string().max(8192).nullable().optional(),
  homepage: z.string().max(2048).nullable().optional(),
  license: z.string().max(256).nullable().optional(),
  stargazersCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().max(64).optional(),
});

export const linkedReposPutBodySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  provider: gitProviderSchema,
  repos: z.array(linkedRepoItemSchema).max(100),
});

export const oneworkProjectRepoBodySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const oauthCallbackQuerySchema = z
  .object({
    code: z.string().min(1).optional(),
    state: z.string().min(1),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .refine((d) => Boolean(d.code) || Boolean(d.error), {
    message: "Missing OAuth code or error",
  });

export const reposListQuerySchema = workspaceIdQuerySchema.extend({
  q: z.string().max(256).optional(),
  page: z.coerce.number().int().positive().max(100).optional().default(1),
});

export const contentsQuerySchema = workspaceIdQuerySchema.extend({
  path: z.string().max(4096).optional().default(""),
  ref: z.string().max(256).optional(),
});

export const fileQuerySchema = workspaceIdQuerySchema.extend({
  path: z.string().min(1, "path required").max(4096),
  ref: z.string().max(256).optional(),
});

export const readmeQuerySchema = workspaceIdQuerySchema.extend({
  ref: z.string().max(256).optional(),
});

export const branchesQuerySchema = workspaceIdQuerySchema;

export const createBranchBodySchema = z.object({
  workspaceId: z.string().uuid(),
  branchName: z.string().min(1).max(256),
  fromRef: z.string().min(1).max(256),
});

export const commitFileBodySchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().min(1).max(4096),
  content: z.string().max(2_000_000),
  message: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
  sha: z.string().max(128).nullable().optional(),
});

export const pullCreateHintQuerySchema = workspaceIdQuerySchema.extend({
  base: z.string().min(1).max(256),
  compare: z.string().min(1).max(256),
});

export const commitsQuerySchema = workspaceIdQuerySchema.extend({
  ref: z.string().max(256).optional(),
  page: z.coerce.number().int().positive().max(100).optional().default(1),
});

export const pullsQuerySchema = workspaceIdQuerySchema.extend({
  state: z.enum(["open", "closed"]).optional().default("open"),
  page: z.coerce.number().int().positive().max(100).optional().default(1),
  templates: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export const createPullRequestBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  projectId: z.string().uuid("Invalid project ID").optional(),
  title: z.string().min(1, "Title is required").max(512),
  description: z.string().max(65536).optional().default(""),
  base: z.string().min(1).max(256),
  head: z.string().min(1).max(256),
  draft: z.boolean().optional(),
});

export const branchProtectionQuerySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  projectId: z.string().uuid("Invalid project ID"),
});

export const branchProtectionPutBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  projectId: z.string().uuid("Invalid project ID"),
  rules: z
    .array(
      z.object({
        branch_pattern: z.string().min(1).max(256),
        require_approval_count: z.number().int().min(0).max(20),
        require_status_checks: z.boolean(),
        required_check_names: z.array(z.string().min(1).max(256)).max(50),
        block_force_push: z.boolean(),
        allow_admin_bypass: z.boolean(),
      }),
    )
    .max(20),
});

export const updatePullBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  title: z.string().min(1).max(512).optional(),
  description: z.string().max(65536).optional(),
  draft: z.boolean().optional(),
});

export const postPullReviewCommentBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  body: z.string().min(1, "Comment is required").max(65536),
  path: z.string().min(1).max(4096),
  line: z.number().int().positive(),
  side: z.enum(["LEFT", "RIGHT"]).optional(),
});

export const pullLabelsBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  labels: z.array(z.string().min(1).max(100)).max(30),
});

export const repoCollaboratorPermissionSchema = z.enum([
  "pull",
  "triage",
  "push",
  "maintain",
  "admin",
]);

export const addRepoCollaboratorBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  username: z
    .string()
    .min(1, "Username is required")
    .max(39)
    .transform((s) => s.trim().replace(/^@/, ""))
    .refine((s) => s.length > 0, "Username is required"),
  permission: repoCollaboratorPermissionSchema.optional().default("push"),
});

export const pullNumberParamsSchema = z.object({
  number: z.coerce.number().int().positive(),
});

export const ownerRepoParamsSchema = z.object({
  owner: z.string().min(1).max(255),
  repo: z.string().min(1).max(255),
});

export const postPullCommentBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  body: z.string().min(1, "Comment is required").max(65536),
});

export const mergePullBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  projectId: z.string().uuid("Invalid project ID").optional(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  squash: z.boolean().optional(),
  deleteBranchAfterMerge: z.boolean().optional(),
});

export const closePullBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
});

export const submitPullReviewBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  body: z.string().max(65536).optional().default(""),
});

export const requestPullReviewersBodySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace ID"),
  reviewers: z.array(z.string().min(1).max(100)).min(1).max(20),
});

export type GitProviderInput = z.infer<typeof gitProviderSchema>;
