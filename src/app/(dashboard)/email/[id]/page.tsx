import EmailDetailView from "@/components/email/EmailDetailView";

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="absolute inset-0 flex flex-col bg-background-dark min-w-0">
      <EmailDetailView emailId={id} />
    </div>
  );
}
