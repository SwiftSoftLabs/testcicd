import PullRequestDetailPage from "@/components/version-control/PullRequestDetailPage";

export default async function VersionControlPullPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await params;

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-background-dark">
      <PullRequestDetailPage />
    </div>
  );
}
