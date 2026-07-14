import EmailComposeView from "@/components/email/EmailComposeView";

export default function EmailComposePage() {
  return (
    <div className="absolute inset-0 flex flex-col bg-background-dark bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(25,93,230,0.12),transparent_55%)]">
      <EmailComposeView />
    </div>
  );
}
