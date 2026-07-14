"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useUIContext } from "@/context/UIContext";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const FAQ_ITEMS = [
  {
    q: "How do I create a workspace?",
    a: "After signing in, click 'Create Workspace' on the dashboard. Give it a name and invite your team. Each workspace is fully isolated with its own projects, tasks, and members.",
  },
  {
    q: "How do I invite team members?",
    a: "Go to Workspace Settings → Members → Invite. Enter the email addresses of people you'd like to add. They'll receive an invitation link to join your workspace.",
  },
  {
    q: "How does billing work?",
    a: "OneWork offers a free tier for small teams. Upgrading to Max unlocks higher storage limits, advanced features, and priority support. Billing is managed per workspace.",
  },
  {
    q: "How do I start a video call?",
    a: "Open the Calls section from the sidebar. Click 'New Call' to create a session and share the link with your team members. Calls support screen sharing and real-time collaboration.",
  },
  {
    q: "Can I integrate my calendar?",
    a: "Yes. Go to Settings → Integrations and connect your Google or Outlook calendar. Events will sync automatically so you can manage your schedule alongside your tasks.",
  },
  {
    q: "How do I reset my password?",
    a: "On the login page, click 'Forgot password?' and enter your email. You'll receive a reset link within a few minutes. If the email doesn't arrive, check your spam folder.",
  },
];

function FAQAccordion() {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => (
        <div
          key={i}
          className="border border-border-dark rounded-xl overflow-hidden"
        >
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="cursor-pointer w-full px-5 py-4 flex items-center justify-between text-left hover:bg-surface-dark/60 transition-colors"
          >
            <span className="text-sm font-medium text-main">{item.q}</span>
            <span className="material-symbols-outlined text-[20px] text-text-secondary ml-3 flex-shrink-0 transition-transform duration-200" style={{ transform: expanded === i ? "rotate(180deg)" : "rotate(0deg)" }}>
              expand_more
            </span>
          </button>
          <AnimatePresence initial={false}>
            {expanded === i && (
              <motion.div
                key="content"
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-4 text-sm text-text-secondary border-t border-border-dark pt-3">
                  {item.a}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export default function SupportPage() {
  const { addToast } = useUIContext();

  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await authenticatedFetch("/api/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to send");
      }
      addToast("Message sent! We'll get back to you soon.", "success");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to send message",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full bg-surface-dark border border-border-dark rounded-lg px-4 py-2.5 text-sm text-main placeholder:text-text-secondary/50 focus:outline-none focus:border-primary transition-colors";

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-10 space-y-10">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-main">Support Center</h1>
          <p className="text-sm text-text-secondary mt-1">
            Find answers to common questions or reach out to our team.
          </p>
        </div>

        {/* FAQ */}
        <section>
          <h2 className="text-base font-semibold text-main mb-4">
            Frequently Asked Questions
          </h2>
          <FAQAccordion />
        </section>

        {/* Contact form */}
        <section>
          <h2 className="text-base font-semibold text-main mb-1">
            Contact Us
          </h2>
          <p className="text-sm text-text-secondary mb-5">
            Can't find what you're looking for? Send us a message and we'll
            respond as soon as possible.
          </p>
          <form
            onSubmit={handleSubmit}
            className="bg-surface-dark border border-border-dark rounded-xl p-6 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                  Name
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  placeholder="Your name"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                Subject
              </label>
              <input
                name="subject"
                value={form.subject}
                onChange={handleChange}
                required
                placeholder="What's this about?"
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                Message
              </label>
              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                required
                rows={5}
                placeholder="Describe your issue or question in detail..."
                className={`${inputClass} resize-none`}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
              >
                {submitting && (
                  <span className="material-symbols-outlined text-[16px] animate-spin">
                    progress_activity
                  </span>
                )}
                {submitting ? "Sending…" : "Send Message"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
