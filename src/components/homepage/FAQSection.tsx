"use client";

import { useRef, useState } from "react";
import { gsap } from "gsap";

const FAQS = [
  {
    q: "Is OneWork free to start?",
    a: "Yes. The free Starter plan supports up to 3 team members with access to all 8 modules — Tasks, Files, Chat, Email, Calendar, Version Control, Analytics, and Smart Inbox — within usage limits. No credit card required.",
  },
  {
    q: "Does it replace Jira or Linear?",
    a: "It can. OneWork's Sprint Engine covers sprint planning, kanban boards, and burndown charts natively. It also integrates with Jira and Linear if you prefer to migrate gradually.",
  },
  {
    q: "Can I import my existing projects?",
    a: "Yes. One-click import from Jira, GitHub Issues, and Notion. CSV import is available for everything else. Your data, your pace.",
  },
  {
    q: "How is my data secured?",
    a: "All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We maintain SOC 2 Type II compliance. Team plan customers can opt for on-premise deployment with full data residency control.",
  },
  {
    q: "Does real-time collaboration work offline?",
    a: "Yes. Changes are queued locally using a conflict-free sync model and pushed instantly when you're back online. You never lose work.",
  },
  {
    q: "Can I connect my existing email?",
    a: "Gmail, Outlook, and custom SMTP/IMAP are all supported. The Smart Inbox unifies all your accounts and uses AI to surface what matters first.",
  },
  {
    q: "Is there a self-hosted option?",
    a: "Yes, available on the Team plan. We provide Docker images and deployment documentation for on-premise setups. Contact us to get started.",
  },
] as const;

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const answerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const openIndexRef = useRef<number | null>(null);

  function toggle(idx: number) {
    const prev = openIndexRef.current;

    if (prev !== null) {
      const prevEl = answerRefs.current[prev];
      if (prevEl) {
        gsap.to(prevEl, {
          height: 0,
          duration: 0.28,
          ease: "power2.in",
          overflow: "hidden",
        });
      }
    }

    if (prev === idx) {
      openIndexRef.current = null;
      setOpenIndex(null);
      return;
    }

    const el = answerRefs.current[idx];
    if (el) {
      el.style.height = "auto";
      const naturalHeight = el.scrollHeight;
      el.style.height = "0px";
      gsap.to(el, {
        height: naturalHeight,
        duration: 0.3,
        ease: "power2.out",
        overflow: "hidden",
      });
    }

    openIndexRef.current = idx;
    setOpenIndex(idx);
  }

  return (
    <section
      id="faq-section"
      className="relative w-full py-32 px-4 sm:px-8 md:px-16 lg:px-24"
      aria-label="Frequently asked questions"
    >
      <div className="max-w-2xl mx-auto">
        <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-4 text-center">
          FAQ
        </p>
        <h2
          className="font-display font-extrabold uppercase text-white text-center mb-16"
          style={{
            fontSize: "clamp(24px, 4vw, 52px)",
            letterSpacing: "-0.02em",
          }}
        >
          COMMON QUESTIONS
        </h2>

        <div role="list">
          {FAQS.map((faq, idx) => (
            <div
              key={idx}
              className={`glass-panel-expand mb-2 rounded-xl overflow-hidden transition-all duration-300 ${openIndex === idx ? "open" : ""}`}
              role="listitem"
            >
              <button
                onClick={() => toggle(idx)}
                className="cursor-pointer w-full flex items-center justify-between py-5 px-5 text-left group"
                aria-expanded={openIndex === idx}
              >
                <span className="font-terminal text-sm uppercase tracking-wider text-white/80 group-hover:text-white transition-colors pr-6">
                  {faq.q}
                </span>
                <span
                  className="font-terminal text-[14px] text-white/50 group-hover:text-white shrink-0 transition-all duration-300"
                  style={{
                    display: "inline-block",
                    transform:
                      openIndex === idx ? "rotate(45deg)" : "rotate(0deg)",
                  }}
                  aria-hidden="true"
                >
                  +
                </span>
              </button>
              <div
                ref={(el) => {
                  answerRefs.current[idx] = el;
                }}
                style={{ height: 0, overflow: "hidden" }}
              >
                <p className="font-terminal text-sm text-white/70 uppercase tracking-wider leading-relaxed px-5 pb-5">
                  {faq.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
